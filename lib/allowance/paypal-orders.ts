// The PayPal side of a purchase: create an order that only AUTHORIZES, let the buyer approve it at
// PayPal, authorize, then capture or void. Funds are never taken until after the policy engine and,
// when required, a human have said yes.

import { paypalRequest } from '../paypal.ts';
import { toDecimalString, type Cents } from './policy.ts';

type Link = { href: string; rel: string; method?: string };

export type PayPalOrder = {
  id: string;
  status: string; // CREATED, PAYER_ACTION_REQUIRED, APPROVED, COMPLETED, VOIDED
  links?: Link[];
  purchase_units?: {
    custom_id?: string;
    payments?: {
      authorizations?: { id: string; status: string; amount: { value: string; currency_code: string } }[];
      captures?: { id: string; status: string; amount: { value: string; currency_code: string } }[];
    };
  }[];
};

export type CreateOrderInput = {
  proposalId: string;
  title: string;
  merchant: string;
  amountCents: Cents;
  currency: string;
  returnUrl: string;
  cancelUrl: string;
};

/** Step 1. intent=AUTHORIZE holds funds later instead of taking them now. Returns the order and the PayPal approval URL. */
export async function createAuthorizeOrder(input: CreateOrderInput) {
  const order = await paypalRequest<PayPalOrder>(
    'POST',
    '/v2/checkout/orders',
    {
      intent: 'AUTHORIZE',
      purchase_units: [
        {
          reference_id: input.proposalId,
          custom_id: input.proposalId,
          description: `${input.title} from ${input.merchant}`.slice(0, 127),
          amount: { currency_code: input.currency, value: toDecimalString(input.amountCents) },
        },
      ],
      payment_source: {
        paypal: {
          experience_context: {
            brand_name: 'Allowance',
            user_action: 'PAY_NOW',
            shipping_preference: 'NO_SHIPPING',
            return_url: input.returnUrl,
            cancel_url: input.cancelUrl,
          },
        },
      },
    },
    { requestId: `allowance-order-${input.proposalId}` },
  );
  const approveUrl = order.links?.find((l) => l.rel === 'payer-action' || l.rel === 'approve')?.href;
  return { order, approveUrl };
}

/** Step 2, after the buyer approved at PayPal. Returns the authorization id that capture and void need. */
export async function authorizeOrder(orderId: string) {
  const order = await paypalRequest<PayPalOrder>('POST', `/v2/checkout/orders/${orderId}/authorize`, {}, {
    requestId: `allowance-authorize-${orderId}`,
  });
  const authorization = order.purchase_units?.[0]?.payments?.authorizations?.[0];
  if (!authorization) throw new Error(`Order ${orderId} came back with no authorization (status ${order.status})`);
  return { order, authorizationId: authorization.id, status: authorization.status };
}

/**
 * Step 3a. Capture all or part of the authorization. A smaller amount is allowed, which is how an
 * agent's estimate gets settled at the final price. Never more than was authorized.
 */
export async function captureAuthorization(authorizationId: string, amountCents: Cents, currency: string) {
  return paypalRequest<{ id: string; status: string; amount: { value: string; currency_code: string } }>(
    'POST',
    `/v2/payments/authorizations/${authorizationId}/capture`,
    { amount: { currency_code: currency, value: toDecimalString(amountCents) }, final_capture: true },
    { requestId: `allowance-capture-${authorizationId}-${amountCents}` },
  );
}

/** Step 3b. Release the hold without charging the buyer. */
export async function voidAuthorization(authorizationId: string) {
  await paypalRequest('POST', `/v2/payments/authorizations/${authorizationId}/void`, undefined, {
    requestId: `allowance-void-${authorizationId}`,
  });
}

export const getOrder = (orderId: string) => paypalRequest<PayPalOrder>('GET', `/v2/checkout/orders/${orderId}`);

// Sandbox test card used as the agent's funding source (see README). Override with SANDBOX_TEST_CARD_* if needed.
const testCard = () => ({
  number: process.env.SANDBOX_TEST_CARD_NUMBER ?? '4111111111111111',
  expiry: process.env.SANDBOX_TEST_CARD_EXPIRY ?? '2030-12',
  security_code: process.env.SANDBOX_TEST_CARD_CVV ?? '123',
  name: 'Allowance Sandbox Buyer',
  billing_address: { address_line_1: '1 Main St', admin_area_2: 'San Jose', admin_area_1: 'CA', postal_code: '95131', country_code: 'US' },
  attributes: { verification: { method: 'SCA_WHEN_REQUIRED' } },
});

/**
 * Sandbox shortcut for a funding instrument the agent holds (a card on file). One call creates the
 * order and authorizes it, so no buyer has to log in. The money still only moves at capture.
 * The wallet path above (createAuthorizeOrder, buyer approval, authorizeOrder) is the real-buyer flow.
 */
export async function createCardAuthorization(input: Omit<CreateOrderInput, 'returnUrl' | 'cancelUrl'>) {
  const order = await paypalRequest<PayPalOrder>(
    'POST',
    '/v2/checkout/orders',
    {
      intent: 'AUTHORIZE',
      purchase_units: [
        {
          reference_id: input.proposalId,
          custom_id: input.proposalId,
          description: `${input.title} from ${input.merchant}`.slice(0, 127),
          amount: { currency_code: input.currency, value: toDecimalString(input.amountCents) },
        },
      ],
      payment_source: { card: testCard() },
    },
    { requestId: `allowance-card-order-${input.proposalId}` },
  );
  const authorization = order.purchase_units?.[0]?.payments?.authorizations?.[0];
  if (!authorization) throw new Error(`Card order ${order.id} was not authorized (status ${order.status})`);
  return { order, authorizationId: authorization.id };
}
