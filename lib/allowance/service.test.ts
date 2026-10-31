// Workflow and agent tests with PayPal and the model mocked at the fetch / chat boundary.
// Nothing here touches the network or the on-disk state file.

process.env.ALLOWANCE_STATE_FILE = 'memory';
process.env.PAYPAL_CLIENT_ID = 'test-id';
process.env.PAYPAL_SECRET = 'test-secret';
process.env.PAYPAL_WEBHOOK_ID = 'WH-TEST';

import assert from 'node:assert/strict';
import { beforeEach, test } from 'node:test';

type Call = { method: string; path: string; body?: any };
let calls: Call[] = [];
let seq = 0;

globalThis.fetch = (async (input: any, init: any = {}) => {
  const url = new URL(String(input));
  const body = init.body && url.pathname !== '/v1/oauth2/token' ? JSON.parse(init.body) : undefined;
  const path = url.pathname;
  const json = (data: unknown, status = 200) =>
    new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } });
  if (path === '/v1/oauth2/token') return json({ access_token: 't', expires_in: 3600 });
  calls.push({ method: init.method ?? 'GET', path, body });
  if (path === '/v2/checkout/orders') {
    const id = `ORDER-${++seq}`;
    const amount = body.purchase_units[0].amount;
    if (body.payment_source.card) {
      return json({
        id,
        status: 'COMPLETED',
        purchase_units: [{ payments: { authorizations: [{ id: `AUTH-${seq}`, status: 'CREATED', amount }] } }],
      });
    }
    return json({ id, status: 'PAYER_ACTION_REQUIRED', links: [{ rel: 'payer-action', href: `https://paypal.example/approve/${id}` }] });
  }
  const authorize = path.match(/^\/v2\/checkout\/orders\/(.+)\/authorize$/);
  if (authorize) {
    return json({ id: authorize[1], status: 'COMPLETED', purchase_units: [{ payments: { authorizations: [{ id: `AUTH-W-${authorize[1]}`, status: 'CREATED', amount: { value: '0', currency_code: 'USD' } }] } }] });
  }
  if (path === '/v1/notifications/verify-webhook-signature') return json({ verification_status: body.transmission_id === 'good' ? 'SUCCESS' : 'FAILURE' });
  if (path.endsWith('/capture')) return json({ id: `CAP-${++seq}`, status: 'COMPLETED', amount: body.amount });
  if (path.endsWith('/void')) return new Response(null, { status: 204 });
  return json({ error: 'unmocked ' + path }, 404);
}) as typeof fetch;

const store = await import('./store.ts');
const service = await import('./service.ts');
const { runAgent } = await import('./agent.ts');
const webhook = await import('./webhook.ts');

const input = (over: Record<string, unknown> = {}) => ({
  mandateId: 'gift-finder',
  productId: 'P1',
  title: 'Wool socks',
  merchant: 'trailhead.example',
  category: 'Socks',
  amountCents: 2400,
  currency: 'USD',
  rationale: 'Warm and cheap.',
  ...over,
});

beforeEach(() => {
  store.resetState();
  calls = [];
  delete process.env.PAYPAL_FUNDING;
});

test('a purchase inside the mandate is authorized with no human, and no money moves until capture', async () => {
  const p = await service.submitProposal(input());
  assert.equal(p.status, 'authorized');
  assert.equal(p.approvedBy, 'policy');
  assert.equal(calls.filter((c) => c.path.endsWith('/capture')).length, 0);
  const order = calls.find((c) => c.path === '/v2/checkout/orders')!;
  assert.equal(order.body.intent, 'AUTHORIZE');
  assert.equal(order.body.purchase_units[0].amount.value, '24.00');
});

test('a denied purchase never reaches PayPal', async () => {
  const p = await service.submitProposal(input({ amountCents: 15001 }));
  assert.equal(p.status, 'denied');
  assert.equal(p.decision.reasons[0].code, 'OVER_PURCHASE_CAP');
  assert.equal(calls.length, 0);
});

test('a purchase above the auto limit waits for a human and creates no PayPal order until approved', async () => {
  const p = await service.submitProposal(input({ amountCents: 9900 }));
  assert.equal(p.status, 'awaiting_human');
  assert.equal(calls.length, 0);
  await service.humanDecide(p.id, 'approve');
  assert.equal(p.status, 'authorized');
  assert.equal(p.approvedBy, 'human');
  assert.equal(calls.filter((c) => c.path === '/v2/checkout/orders').length, 1);
});

test('a rejected purchase is final and never reaches PayPal', async () => {
  const p = await service.submitProposal(input({ amountCents: 9900 }));
  await service.humanDecide(p.id, 'reject');
  assert.equal(p.status, 'rejected');
  assert.equal(calls.length, 0);
  await assert.rejects(() => service.humanDecide(p.id, 'approve'), /not allowed/);
});

test('capture settles at a lower final price, never a higher one', async () => {
  const p = await service.submitProposal(input({ amountCents: 2400 }));
  await assert.rejects(() => service.capture(p.id, 2500), /Capture must be between/);
  await service.capture(p.id, 2150);
  assert.equal(p.status, 'captured');
  assert.equal(p.capturedCents, 2150);
  const capture = calls.find((c) => c.path.endsWith('/capture'))!;
  assert.equal(capture.body.amount.value, '21.50');
  assert.equal(capture.body.final_capture, true);
});

test('void releases the hold, and a captured purchase cannot be voided', async () => {
  const a = await service.submitProposal(input());
  await service.voidPurchase(a.id);
  assert.equal(a.status, 'voided');
  const b = await service.submitProposal(input({ productId: 'P2' }));
  await service.capture(b.id);
  await assert.rejects(() => service.voidPurchase(b.id), /not allowed/);
});

test('committed spend counts against the daily budget, voided spend does not', async () => {
  store.updateMandate('office-restock', { dailyBudgetCents: 5000, autoApproveUpToCents: 5000, perPurchaseCapCents: 5000 });
  const first = await service.submitProposal(input({ mandateId: 'office-restock', amountCents: 3000 }));
  assert.equal(first.status, 'authorized');
  const second = await service.submitProposal(input({ mandateId: 'office-restock', amountCents: 3000 }));
  assert.equal(second.status, 'denied');
  assert.equal(second.decision.reasons[0].code, 'OVER_DAILY_BUDGET');
  await service.voidPurchase(first.id);
  const third = await service.submitProposal(input({ mandateId: 'office-restock', amountCents: 3000 }));
  assert.equal(third.status, 'authorized');
});

test('pausing a mandate stops the next proposal immediately', async () => {
  store.updateMandate('gift-finder', { paused: true });
  const p = await service.submitProposal(input());
  assert.equal(p.status, 'denied');
  assert.equal(p.decision.reasons[0].code, 'MANDATE_PAUSED');
});

test('wallet funding stops at the PayPal approval URL, then authorizes after the buyer returns', async () => {
  process.env.PAYPAL_FUNDING = 'wallet';
  const p = await service.submitProposal(input());
  assert.equal(p.status, 'awaiting_buyer');
  assert.match(p.approveUrl ?? '', /paypal\.example\/approve/);
  await service.completeBuyerApproval(p.id);
  assert.equal(p.status, 'authorized');
  assert.ok(p.authorizationId);
});

// ---- Agent -----------------------------------------------------------------------------------

const offers = [
  { productId: 'S1', title: 'Wool socks', brand: 'Trailhead', merchant: 'trailhead.example', category: 'Socks', priceCents: 2400, currency: 'USD', buyUrl: 'https://x/1' },
  { productId: 'J1', title: 'Wool jacket', brand: 'Summit', merchant: 'summit.example', category: 'Jackets', priceCents: 9900, currency: 'USD', buyUrl: 'https://x/2' },
];
const call = (id: string, name: string, args: unknown) => ({ id, function: { name, arguments: JSON.stringify(args) } });

test('the agent cannot buy an offer it did not find, and cannot set its own price', async () => {
  const script = [
    { content: null, tool_calls: [call('1', 'propose_purchase', { product_id: 'S1', merchant: 'trailhead.example', rationale: 'blind buy' })] },
    { content: null, tool_calls: [call('2', 'search_products', { query: 'socks' })] },
    // The model tries to smuggle in a price. The server must ignore it and use the catalog price.
    { content: null, tool_calls: [call('3', 'propose_purchase', { product_id: 'S1', merchant: 'trailhead.example', rationale: 'ok', amount: 1 })] },
    { content: 'Bought the socks.' },
  ];
  let i = 0;
  const run = await runAgent('gift-finder', 'socks please', { search: async () => offers, chat: async () => script[i++] });
  assert.equal(run.purchases.length, 1);
  assert.equal(run.purchases[0].amountCents, 2400);
  assert.equal(run.purchases[0].status, 'authorized');
});

test('an over-limit proposal from the agent is held for a human and the agent is told so', async () => {
  const seen: string[] = [];
  const script = [
    { content: null, tool_calls: [call('1', 'search_products', { query: 'jacket' })] },
    { content: null, tool_calls: [call('2', 'propose_purchase', { product_id: 'J1', merchant: 'summit.example', rationale: 'warm' })] },
    { content: 'Held for approval.' },
  ];
  let i = 0;
  const run = await runAgent('gift-finder', 'a jacket', {
    search: async () => offers,
    chat: async (messages) => {
      seen.push(JSON.stringify(messages.at(-1)));
      return script[i++];
    },
  });
  assert.equal(run.purchases[0].status, 'awaiting_human');
  assert.match(seen.join(' '), /needs_human/);
  assert.equal(calls.length, 0);
});

// ---- Webhooks --------------------------------------------------------------------------------

test('webhook signatures are checked with PayPal, and a bad one is refused', async () => {
  const event = { id: 'WH-1', event_type: 'PAYMENT.CAPTURE.COMPLETED', resource: {} };
  assert.equal(await webhook.verifySignature(new Headers({ 'paypal-transmission-id': 'good' }), event), true);
  assert.equal(await webhook.verifySignature(new Headers({ 'paypal-transmission-id': 'forged' }), event), false);
  delete process.env.PAYPAL_WEBHOOK_ID;
  assert.equal(await webhook.verifySignature(new Headers({ 'paypal-transmission-id': 'good' }), event), false);
  process.env.PAYPAL_WEBHOOK_ID = 'WH-TEST';
});

test('a void done outside the app is reconciled from the webhook, and a capture event is idempotent', async () => {
  const a = await service.submitProposal(input());
  webhook.applyEvent({ id: 'E1', event_type: 'PAYMENT.AUTHORIZATION.VOIDED', resource: { id: a.authorizationId } });
  assert.equal(a.status, 'voided');
  const b = await service.submitProposal(input({ productId: 'P3' }));
  const capEvent = { id: 'E2', event_type: 'PAYMENT.CAPTURE.COMPLETED', resource: { id: 'CAP-X', supplementary_data: { related_ids: { authorization_id: b.authorizationId } } } };
  webhook.applyEvent(capEvent);
  webhook.applyEvent(capEvent);
  assert.equal(b.status, 'captured');
  assert.equal(b.log.filter((l) => l.event === 'webhook:capture_completed').length, 1);
  assert.equal(webhook.applyEvent({ id: 'E3', event_type: 'PAYMENT.CAPTURE.COMPLETED', resource: { id: 'C', supplementary_data: { related_ids: { authorization_id: 'unknown' } } } }), undefined);
});
