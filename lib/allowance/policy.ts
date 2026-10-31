// The mandate policy engine. Pure functions only: no I/O, no clock, no randomness, so every rule can
// be tested without PayPal or a model. An AI agent never talks to PayPal directly. It proposes a
// purchase, this module decides what may happen to it, and only then does the server touch PayPal.

export type Cents = number;

export type Mandate = {
  id: string;
  /** The agent this mandate belongs to, e.g. "gift-finder". */
  agent: string;
  currency: string;
  /** Anything above this is denied outright, whoever is watching. */
  perPurchaseCapCents: Cents;
  /** At or below this a purchase goes through with no human. Above it a human must approve. */
  autoApproveUpToCents: Cents;
  dailyBudgetCents: Cents;
  /** Optional rolling 30 day budget. */
  monthlyBudgetCents?: Cents;
  /** If set, only these merchants may be paid. Compared case-insensitively. */
  allowedMerchants?: string[];
  blockedMerchants?: string[];
  /** If set, the proposal must carry one of these categories. */
  allowedCategories?: string[];
  /** Auto approvals per rolling hour before the agent is forced to ask a human. */
  maxAutoApprovalsPerHour?: number;
  paused: boolean;
  /** ISO timestamp. A mandate past this instant approves nothing. */
  expiresAt?: string;
};

export type Proposal = {
  id: string;
  mandateId: string;
  merchant: string;
  category?: string;
  title: string;
  amountCents: Cents;
  currency: string;
};

/** Money the mandate has already committed: authorized or captured orders, with how they were approved. */
export type Spend = {
  amountCents: Cents;
  at: string;
  approvedBy: 'policy' | 'human';
};

export type ReasonCode =
  | 'MANDATE_PAUSED'
  | 'MANDATE_EXPIRED'
  | 'BAD_AMOUNT'
  | 'CURRENCY_MISMATCH'
  | 'MERCHANT_BLOCKED'
  | 'MERCHANT_NOT_ALLOWED'
  | 'CATEGORY_NOT_ALLOWED'
  | 'OVER_PURCHASE_CAP'
  | 'OVER_DAILY_BUDGET'
  | 'OVER_MONTHLY_BUDGET'
  | 'ABOVE_AUTO_APPROVE_LIMIT'
  | 'AUTO_APPROVAL_RATE_LIMIT'
  | 'WITHIN_MANDATE';

export type Decision = {
  outcome: 'auto_approve' | 'needs_human' | 'deny';
  reasons: { code: ReasonCode; detail: string }[];
};

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

const fmt = (cents: Cents) => `$${(cents / 100).toFixed(2)}`;
const norm = (s: string) => s.trim().toLowerCase();

/** "12.99" to 1299. Returns undefined for anything that is not a plain non-negative decimal. */
export function toCents(value: string | number): Cents | undefined {
  const text = String(value).trim();
  if (!/^\d+(\.\d{1,2})?$/.test(text)) return undefined;
  const [whole, frac = ''] = text.split('.');
  return Number(whole) * 100 + Number(frac.padEnd(2, '0'));
}

/** 1299 to "12.99", the shape PayPal wants. */
export function toDecimalString(cents: Cents): string {
  return `${Math.floor(cents / 100)}.${String(cents % 100).padStart(2, '0')}`;
}

function sumSince(spend: Spend[], now: Date, windowMs: number): Cents {
  const from = now.getTime() - windowMs;
  return spend.filter((s) => Date.parse(s.at) > from).reduce((total, s) => total + s.amountCents, 0);
}

export function evaluate(mandate: Mandate, proposal: Proposal, spend: Spend[], now: Date): Decision {
  const deny = (code: ReasonCode, detail: string): Decision => ({ outcome: 'deny', reasons: [{ code, detail }] });

  if (mandate.paused) return deny('MANDATE_PAUSED', `Mandate for ${mandate.agent} is paused.`);
  if (mandate.expiresAt && Date.parse(mandate.expiresAt) <= now.getTime()) {
    return deny('MANDATE_EXPIRED', `Mandate expired at ${mandate.expiresAt}.`);
  }
  if (!Number.isInteger(proposal.amountCents) || proposal.amountCents <= 0) {
    return deny('BAD_AMOUNT', 'The amount must be a positive whole number of cents.');
  }
  if (proposal.currency !== mandate.currency) {
    return deny('CURRENCY_MISMATCH', `Mandate pays in ${mandate.currency}, the proposal is in ${proposal.currency}.`);
  }

  const merchant = norm(proposal.merchant);
  if (mandate.blockedMerchants?.some((m) => norm(m) === merchant)) {
    return deny('MERCHANT_BLOCKED', `${proposal.merchant} is on the blocked list.`);
  }
  if (mandate.allowedMerchants && !mandate.allowedMerchants.some((m) => norm(m) === merchant)) {
    return deny('MERCHANT_NOT_ALLOWED', `${proposal.merchant} is not on the allowed merchant list.`);
  }
  if (mandate.allowedCategories) {
    const category = proposal.category ? norm(proposal.category) : undefined;
    if (!category || !mandate.allowedCategories.some((c) => norm(c) === category)) {
      return deny('CATEGORY_NOT_ALLOWED', `Category ${proposal.category ?? '(none)'} is not allowed.`);
    }
  }
  if (proposal.amountCents > mandate.perPurchaseCapCents) {
    return deny('OVER_PURCHASE_CAP', `${fmt(proposal.amountCents)} is above the ${fmt(mandate.perPurchaseCapCents)} per purchase cap.`);
  }

  const today = sumSince(spend, now, DAY_MS);
  if (today + proposal.amountCents > mandate.dailyBudgetCents) {
    return deny(
      'OVER_DAILY_BUDGET',
      `${fmt(today)} already committed in the last 24 hours, so ${fmt(proposal.amountCents)} would pass the ${fmt(mandate.dailyBudgetCents)} daily budget.`,
    );
  }
  if (mandate.monthlyBudgetCents !== undefined) {
    const month = sumSince(spend, now, 30 * DAY_MS);
    if (month + proposal.amountCents > mandate.monthlyBudgetCents) {
      return deny(
        'OVER_MONTHLY_BUDGET',
        `${fmt(month)} already committed in the last 30 days, so ${fmt(proposal.amountCents)} would pass the ${fmt(mandate.monthlyBudgetCents)} monthly budget.`,
      );
    }
  }

  if (proposal.amountCents > mandate.autoApproveUpToCents) {
    return {
      outcome: 'needs_human',
      reasons: [
        {
          code: 'ABOVE_AUTO_APPROVE_LIMIT',
          detail: `${fmt(proposal.amountCents)} is above the ${fmt(mandate.autoApproveUpToCents)} the agent may spend on its own.`,
        },
      ],
    };
  }

  if (mandate.maxAutoApprovalsPerHour !== undefined) {
    const lastHour = spend.filter((s) => s.approvedBy === 'policy' && Date.parse(s.at) > now.getTime() - HOUR_MS).length;
    if (lastHour >= mandate.maxAutoApprovalsPerHour) {
      return {
        outcome: 'needs_human',
        reasons: [
          {
            code: 'AUTO_APPROVAL_RATE_LIMIT',
            detail: `${lastHour} purchases were auto approved in the last hour, the limit is ${mandate.maxAutoApprovalsPerHour}.`,
          },
        ],
      };
    }
  }

  return {
    outcome: 'auto_approve',
    reasons: [{ code: 'WITHIN_MANDATE', detail: `${fmt(proposal.amountCents)} is inside every limit of the mandate.` }],
  };
}

// ---- Purchase lifecycle -------------------------------------------------------------------------

export type PurchaseStatus =
  | 'proposed'
  | 'denied'
  | 'awaiting_human'
  | 'awaiting_buyer' // order created, waiting for the buyer to approve it at PayPal
  | 'authorized' // PayPal holds the funds
  | 'captured'
  | 'voided'
  | 'rejected' // a human said no
  | 'failed';

export type PurchaseEvent =
  | 'policy_denied'
  | 'policy_needs_human'
  | 'policy_approved'
  | 'human_approved'
  | 'human_rejected'
  | 'buyer_approved_and_authorized'
  | 'captured'
  | 'voided'
  | 'failed';

const TRANSITIONS: Record<PurchaseStatus, Partial<Record<PurchaseEvent, PurchaseStatus>>> = {
  proposed: {
    policy_denied: 'denied',
    policy_needs_human: 'awaiting_human',
    policy_approved: 'awaiting_buyer',
    failed: 'failed',
  },
  denied: {},
  awaiting_human: { human_approved: 'awaiting_buyer', human_rejected: 'rejected', failed: 'failed' },
  awaiting_buyer: { buyer_approved_and_authorized: 'authorized', voided: 'voided', failed: 'failed' },
  authorized: { captured: 'captured', voided: 'voided', failed: 'failed' },
  captured: {},
  voided: {},
  rejected: {},
  failed: {},
};

/** Returns the next status, or undefined when the event is not allowed from the current status. */
export function next(status: PurchaseStatus, event: PurchaseEvent): PurchaseStatus | undefined {
  return TRANSITIONS[status][event];
}

/** Statuses whose amount still counts against the mandate budgets. */
export const COMMITTED: PurchaseStatus[] = ['authorized', 'captured'];
