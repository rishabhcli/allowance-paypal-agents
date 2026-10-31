// What the AG Studio dashboard reads: flat rows built from the Allowance store (mandates, purchases
// and their audit events). Money is in dollars here because that is what Studio formats.

import { hydrate, purchases as allPurchases, mandates as allMandates, type Purchase } from './allowance/store.ts';

export type MandateRow = {
  id: string;
  agent: string;
  state: 'Active' | 'Paused';
  perPurchaseCap: number;
  autoApproveLimit: number;
  dailyBudget: number;
  monthlyBudget: number;
  spentToday: number;
};

export type PurchaseRow = {
  id: string;
  mandateId: string;
  agent: string;
  title: string;
  merchant: string;
  category: string;
  createdAt: string;
  createdDate: string;
  requested: number;
  committed: number; // authorized or captured, minus the part never captured
  captured: number;
  waiting: number; // held for a person
  exposure: number; // committed plus waiting: real money or money a person still has to decide on
  stopped: number; // denied by policy or rejected by a person
  one: number;
  isAuto: number;
  isHeld: number;
  isStopped: number;
  statusGroup: string;
  outcome: string;
  reason: string;
  approvedBy: string;
};

export type EventRow = { id: string; purchaseId: string; at: string; event: string; note: string };

export type DashboardData = {
  asOf: string;
  mandates: MandateRow[];
  purchases: PurchaseRow[];
  events: EventRow[];
};

const dollars = (cents: number) => Math.round(cents) / 100;

export const STATUS_GROUP: Record<Purchase['status'], string> = {
  proposed: 'In progress',
  denied: 'Stopped by policy',
  awaiting_human: 'Waiting for a person',
  awaiting_buyer: 'Waiting for the buyer',
  authorized: 'Authorized, funds on hold',
  captured: 'Captured',
  voided: 'Voided',
  rejected: 'Rejected by a person',
  failed: 'Failed',
};

const OUTCOME = { auto_approve: 'Approved by policy', needs_human: 'Held for a person', deny: 'Denied by policy' } as const;

const REASON_LABEL: Record<string, string> = {
  MANDATE_PAUSED: 'Mandate paused',
  MANDATE_EXPIRED: 'Mandate expired',
  BAD_AMOUNT: 'Bad amount',
  CURRENCY_MISMATCH: 'Wrong currency',
  MERCHANT_BLOCKED: 'Merchant blocked',
  MERCHANT_NOT_ALLOWED: 'Merchant not allowed',
  CATEGORY_NOT_ALLOWED: 'Category not allowed',
  OVER_PURCHASE_CAP: 'Over the per purchase cap',
  OVER_DAILY_BUDGET: 'Over the daily budget',
  OVER_MONTHLY_BUDGET: 'Over the monthly budget',
  ABOVE_AUTO_APPROVE_LIMIT: 'Above what the agent may spend alone',
  AUTO_APPROVAL_RATE_LIMIT: 'Too many auto approvals this hour',
  WITHIN_MANDATE: 'Inside every limit',
};

export function purchaseRow(p: Purchase): PurchaseRow {
  const status = p.status;
  const committedCents = status === 'captured' ? (p.capturedCents ?? p.amountCents) : status === 'authorized' ? p.amountCents : 0;
  const stopped = status === 'denied' || status === 'rejected';
  const reason = p.decision.reasons[0]?.code ?? 'WITHIN_MANDATE';
  return {
    id: p.id,
    mandateId: p.mandateId,
    agent: p.agent,
    title: p.title,
    merchant: p.merchant,
    category: p.category ?? 'Uncategorised',
    createdAt: p.createdAt.slice(0, 19) + 'Z',
    createdDate: p.createdAt.slice(0, 10),
    requested: dollars(p.amountCents),
    committed: dollars(committedCents),
    captured: dollars(status === 'captured' ? (p.capturedCents ?? p.amountCents) : 0),
    waiting: dollars(status === 'awaiting_human' ? p.amountCents : 0),
    exposure: dollars(committedCents + (status === 'awaiting_human' ? p.amountCents : 0)),
    stopped: dollars(stopped ? p.amountCents : 0),
    one: 1,
    isAuto: p.approvedBy === 'policy' ? 1 : 0,
    isHeld: status === 'awaiting_human' || p.approvedBy === 'human' ? 1 : 0,
    isStopped: stopped ? 1 : 0,
    statusGroup: STATUS_GROUP[status],
    outcome: OUTCOME[p.decision.outcome],
    reason: REASON_LABEL[reason] ?? reason,
    approvedBy: p.approvedBy === 'human' ? 'A person' : p.approvedBy === 'policy' ? 'Policy' : 'Nobody',
  };
}

export async function getDashboardData(): Promise<DashboardData> {
  await hydrate();
  const purchases = allPurchases();
  const now = Date.now();
  const mandates: MandateRow[] = allMandates().map((m) => {
    const spent = purchases
      .filter((p) => p.mandateId === m.id && (p.status === 'authorized' || p.status === 'captured') && Date.parse(p.updatedAt) > now - 864e5)
      .reduce((total, p) => total + (p.capturedCents ?? p.amountCents), 0);
    return {
      id: m.id,
      agent: m.agent,
      state: m.paused ? 'Paused' : 'Active',
      perPurchaseCap: dollars(m.perPurchaseCapCents),
      autoApproveLimit: dollars(m.autoApproveUpToCents),
      dailyBudget: dollars(m.dailyBudgetCents),
      monthlyBudget: dollars(m.monthlyBudgetCents ?? m.dailyBudgetCents * 30),
      spentToday: dollars(spent),
    };
  });
  return {
    asOf: new Date().toISOString(),
    mandates,
    purchases: purchases.map(purchaseRow),
    events: purchases.flatMap((p) => p.log.map((l, i) => ({ id: `${p.id}:${i}`, purchaseId: p.id, at: l.at.slice(0, 19) + 'Z', event: l.event.replace(/_/g, ' '), note: l.note ?? '' }))),
  };
}

