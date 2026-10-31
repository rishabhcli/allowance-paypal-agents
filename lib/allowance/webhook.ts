// PayPal webhooks: verify the signature with PayPal's own endpoint, then reconcile our records.
// The dashboard also shows the effect: a capture or void done outside the app still shows up here.

import { paypalRequest } from '../paypal.ts';
import { next } from './policy.ts';
import * as store from './store.ts';

export type WebhookEvent = {
  id: string;
  event_type: string;
  resource: { id?: string; status?: string; supplementary_data?: { related_ids?: { order_id?: string; authorization_id?: string } } };
};

export async function verifySignature(headers: Headers, event: unknown): Promise<boolean> {
  const webhookId = process.env.PAYPAL_WEBHOOK_ID;
  if (!webhookId) return false;
  const result = await paypalRequest<{ verification_status: string }>('POST', '/v1/notifications/verify-webhook-signature', {
    auth_algo: headers.get('paypal-auth-algo'),
    cert_url: headers.get('paypal-cert-url'),
    transmission_id: headers.get('paypal-transmission-id'),
    transmission_sig: headers.get('paypal-transmission-sig'),
    transmission_time: headers.get('paypal-transmission-time'),
    webhook_id: webhookId,
    webhook_event: event,
  });
  return result.verification_status === 'SUCCESS';
}

/** Reconcile one verified event. Returns a short note, or undefined when the event is not ours. */
export function applyEvent(event: WebhookEvent): string | undefined {
  const related = event.resource.supplementary_data?.related_ids;
  if (event.event_type === 'PAYMENT.AUTHORIZATION.VOIDED' && event.resource.id) {
    const p = store.findByAuthorization(event.resource.id);
    if (!p) return undefined;
    const to = next(p.status, 'voided');
    if (to) {
      p.status = to;
      store.touch(p, 'webhook:authorization_voided', event.id);
    }
    return `authorization ${event.resource.id} voided`;
  }
  if (event.event_type === 'PAYMENT.CAPTURE.COMPLETED') {
    const p = (related?.authorization_id && store.findByAuthorization(related.authorization_id)) || (related?.order_id && store.findByOrder(related.order_id)) || undefined;
    if (!p) return undefined;
    const to = next(p.status, 'captured');
    if (to) {
      p.status = to;
      p.captureId = p.captureId ?? event.resource.id;
      store.touch(p, 'webhook:capture_completed', event.id);
    } else {
      store.touch(p, 'webhook:capture_completed_duplicate', event.id);
    }
    return `capture ${event.resource.id} completed`;
  }
  return undefined;
}
