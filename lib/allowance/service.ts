// The purchase workflow. Every path to money goes through here: policy decision first, a human when
// the policy asks for one, PayPal authorization only after that, capture or void last.

import { randomUUID } from 'node:crypto';
import {
  authorizeOrder,
  captureAuthorization,
  createAuthorizeOrder,
  createCardAuthorization,
  voidAuthorization,
} from './paypal-orders.ts';
import { COMMITTED, evaluate, next, type PurchaseEvent, type Proposal, type Spend } from './policy.ts';
import * as store from './store.ts';
import type { Purchase } from './store.ts';

export type ProposalInput = {
  mandateId: string;
  productId: string;
  title: string;
  merchant: string;
  category?: string;
  amountCents: number;
  currency: string;
  buyUrl?: string;
  rationale: string;
};

const baseUrl = () => process.env.APP_BASE_URL ?? 'http://localhost:3000';

function spendFor(mandateId: string): Spend[] {
  return store
    .purchases()
    .filter((p) => p.mandateId === mandateId && COMMITTED.includes(p.status))
    .map((p) => ({ amountCents: p.capturedCents ?? p.amountCents, at: p.updatedAt, approvedBy: p.approvedBy ?? 'policy' }));
}

function move(p: Purchase, event: PurchaseEvent, note?: string) {
  const to = next(p.status, event);
  if (!to) throw new Error(`Purchase ${p.id} is ${p.status}; ${event} is not allowed from there`);
  p.status = to;
  store.touch(p, event, note);
}

/** 'card' (default) authorizes with a sandbox test card in one call. 'wallet' stops at the PayPal approval URL for a real buyer. */
const funding = () => (process.env.PAYPAL_FUNDING === 'wallet' ? 'wallet' : 'card');

async function openOrder(p: Purchase) {
  // Retries inside one call reuse the same key (idempotent); a new approval after a failure gets a new one.
  const attempt = Date.now().toString(36);
  if (funding() === 'card') {
    const { order, authorizationId } = await createCardAuthorization({
      proposalId: p.id,
      title: p.title,
      merchant: p.merchant,
      amountCents: p.amountCents,
      currency: p.currency,
      attempt,
    });
    p.orderId = order.id;
    store.touch(p, 'order_created', `PayPal order ${order.id}, intent AUTHORIZE, funded by the sandbox test card`);
    p.authorizationId = authorizationId;
    move(p, 'buyer_approved_and_authorized', `Authorization ${authorizationId}`);
    return;
  }
  const { order, approveUrl } = await createAuthorizeOrder({
    proposalId: p.id,
    title: p.title,
    merchant: p.merchant,
    amountCents: p.amountCents,
    currency: p.currency,
    returnUrl: `${baseUrl()}/api/paypal/return?purchase=${p.id}`,
    cancelUrl: `${baseUrl()}/api/paypal/cancel?purchase=${p.id}`,
    attempt,
  });
  p.orderId = order.id;
  p.approveUrl = approveUrl;
  store.touch(p, 'order_created', `PayPal order ${order.id}, intent AUTHORIZE`);
}

/** An agent proposes a purchase. Returns the stored purchase with the policy decision applied. */
export async function submitProposal(input: ProposalInput, now = new Date()): Promise<Purchase> {
  const mandate = store.getMandate(input.mandateId);
  if (!mandate) throw new Error(`No mandate ${input.mandateId}`);
  const proposal: Proposal = { id: randomUUID(), ...input };
  const decision = evaluate(mandate, proposal, spendFor(mandate.id), now);
  const at = now.toISOString();
  const p: Purchase = {
    id: proposal.id,
    mandateId: mandate.id,
    agent: mandate.agent,
    productId: input.productId,
    title: input.title,
    merchant: input.merchant,
    category: input.category,
    amountCents: input.amountCents,
    currency: input.currency,
    buyUrl: input.buyUrl,
    rationale: input.rationale,
    status: 'proposed',
    decision,
    createdAt: at,
    updatedAt: at,
    log: [{ at, event: 'proposed', note: input.rationale }],
  };
  store.addPurchase(p);

  if (decision.outcome === 'deny') {
    move(p, 'policy_denied', decision.reasons[0].detail);
  } else if (decision.outcome === 'needs_human') {
    move(p, 'policy_needs_human', decision.reasons[0].detail);
  } else {
    p.approvedBy = 'policy';
    move(p, 'policy_approved', decision.reasons[0].detail);
    await openOrder(p);
  }
  return p;
}

/** A person answers a purchase the policy held for them. */
export async function humanDecide(id: string, verdict: 'approve' | 'reject'): Promise<Purchase> {
  const p = store.getPurchase(id);
  if (!p) throw new Error(`No purchase ${id}`);
  if (verdict === 'reject') {
    move(p, 'human_rejected');
    return p;
  }
  p.approvedBy = 'human';
  move(p, 'human_approved');
  await openOrder(p);
  return p;
}

/** The buyer came back from PayPal approved: authorize the order, which places the hold. */
export async function completeBuyerApproval(id: string): Promise<Purchase> {
  const p = store.getPurchase(id);
  if (!p?.orderId) throw new Error(`Purchase ${id} has no PayPal order`);
  const { authorizationId } = await authorizeOrder(p.orderId);
  p.authorizationId = authorizationId;
  move(p, 'buyer_approved_and_authorized', `Authorization ${authorizationId}`);
  return p;
}

/** Take the money. A final amount below the authorized one is allowed, above it is not. */
export async function capture(id: string, finalCents?: number): Promise<Purchase> {
  const p = store.getPurchase(id);
  if (!p?.authorizationId) throw new Error(`Purchase ${id} is not authorized`);
  const amount = finalCents ?? p.amountCents;
  if (amount <= 0 || amount > p.amountCents) throw new Error(`Capture must be between 1 cent and the authorized ${p.amountCents} cents`);
  const result = await captureAuthorization(p.authorizationId, amount, p.currency);
  p.captureId = result.id;
  p.capturedCents = amount;
  move(p, 'captured', `Capture ${result.id}`);
  return p;
}

export async function voidPurchase(id: string): Promise<Purchase> {
  const p = store.getPurchase(id);
  if (!p?.authorizationId) throw new Error(`Purchase ${id} is not authorized`);
  await voidAuthorization(p.authorizationId);
  move(p, 'voided');
  return p;
}
