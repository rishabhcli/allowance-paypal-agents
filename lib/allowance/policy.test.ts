import assert from 'node:assert/strict';
import { test } from 'node:test';
import { evaluate, next, toCents, toDecimalString, type Mandate, type Proposal, type Spend } from './policy.ts';

const NOW = new Date('2026-11-02T18:00:00Z');
const minutesAgo = (m: number) => new Date(NOW.getTime() - m * 60_000).toISOString();

const mandate = (over: Partial<Mandate> = {}): Mandate => ({
  id: 'm1',
  agent: 'gift-finder',
  currency: 'USD',
  perPurchaseCapCents: 15000,
  autoApproveUpToCents: 3000,
  dailyBudgetCents: 20000,
  paused: false,
  ...over,
});

const proposal = (over: Partial<Proposal> = {}): Proposal => ({
  id: 'p1',
  mandateId: 'm1',
  merchant: 'Acme Outfitters',
  category: 'apparel',
  title: 'Wool socks',
  amountCents: 1800,
  currency: 'USD',
  ...over,
});

const spend = (amountCents: number, at: string, approvedBy: Spend['approvedBy'] = 'policy'): Spend => ({
  amountCents,
  at,
  approvedBy,
});

test('a small purchase inside every limit is auto approved', () => {
  const d = evaluate(mandate(), proposal(), [], NOW);
  assert.equal(d.outcome, 'auto_approve');
  assert.equal(d.reasons[0].code, 'WITHIN_MANDATE');
});

test('the auto approve limit is inclusive', () => {
  assert.equal(evaluate(mandate(), proposal({ amountCents: 3000 }), [], NOW).outcome, 'auto_approve');
  assert.equal(evaluate(mandate(), proposal({ amountCents: 3001 }), [], NOW).outcome, 'needs_human');
});

test('above the auto limit but under the cap asks a human', () => {
  const d = evaluate(mandate(), proposal({ amountCents: 9900 }), [], NOW);
  assert.equal(d.outcome, 'needs_human');
  assert.equal(d.reasons[0].code, 'ABOVE_AUTO_APPROVE_LIMIT');
});

test('above the per purchase cap is denied even though a human could say yes', () => {
  const d = evaluate(mandate(), proposal({ amountCents: 15001 }), [], NOW);
  assert.equal(d.outcome, 'deny');
  assert.equal(d.reasons[0].code, 'OVER_PURCHASE_CAP');
});

test('a paused mandate denies everything', () => {
  const d = evaluate(mandate({ paused: true }), proposal(), [], NOW);
  assert.deepEqual([d.outcome, d.reasons[0].code], ['deny', 'MANDATE_PAUSED']);
});

test('an expired mandate denies, an unexpired one does not', () => {
  assert.equal(evaluate(mandate({ expiresAt: minutesAgo(1) }), proposal(), [], NOW).reasons[0].code, 'MANDATE_EXPIRED');
  assert.equal(evaluate(mandate({ expiresAt: minutesAgo(-60) }), proposal(), [], NOW).outcome, 'auto_approve');
});

test('zero, negative and fractional cent amounts are denied', () => {
  for (const amountCents of [0, -5, 10.5, Number.NaN]) {
    assert.equal(evaluate(mandate(), proposal({ amountCents }), [], NOW).reasons[0].code, 'BAD_AMOUNT');
  }
});

test('a currency the mandate does not pay in is denied', () => {
  assert.equal(evaluate(mandate(), proposal({ currency: 'EUR' }), [], NOW).reasons[0].code, 'CURRENCY_MISMATCH');
});

test('blocked merchants lose to everything else, case insensitively', () => {
  const m = mandate({ blockedMerchants: ['acme outfitters'] });
  assert.equal(evaluate(m, proposal(), [], NOW).reasons[0].code, 'MERCHANT_BLOCKED');
});

test('an allow list denies merchants that are not on it', () => {
  const m = mandate({ allowedMerchants: ['Trailhead Supply'] });
  assert.equal(evaluate(m, proposal(), [], NOW).reasons[0].code, 'MERCHANT_NOT_ALLOWED');
  assert.equal(evaluate(m, proposal({ merchant: ' trailhead supply ' }), [], NOW).outcome, 'auto_approve');
});

test('a category list denies a missing or different category', () => {
  const m = mandate({ allowedCategories: ['books'] });
  assert.equal(evaluate(m, proposal(), [], NOW).reasons[0].code, 'CATEGORY_NOT_ALLOWED');
  assert.equal(evaluate(m, proposal({ category: undefined }), [], NOW).reasons[0].code, 'CATEGORY_NOT_ALLOWED');
  assert.equal(evaluate(m, proposal({ category: 'Books' }), [], NOW).outcome, 'auto_approve');
});

test('the daily budget counts the last 24 hours only', () => {
  const m = mandate({ dailyBudgetCents: 5000 });
  const recent = [spend(4000, minutesAgo(60))];
  assert.equal(evaluate(m, proposal({ amountCents: 1500 }), recent, NOW).reasons[0].code, 'OVER_DAILY_BUDGET');
  const old = [spend(4000, minutesAgo(25 * 60))];
  assert.equal(evaluate(m, proposal({ amountCents: 1500 }), old, NOW).outcome, 'auto_approve');
});

test('spending exactly to the daily budget is allowed', () => {
  const m = mandate({ dailyBudgetCents: 5000 });
  assert.equal(evaluate(m, proposal({ amountCents: 1000 }), [spend(4000, minutesAgo(5))], NOW).outcome, 'auto_approve');
});

test('the monthly budget is checked after the daily one', () => {
  const m = mandate({ dailyBudgetCents: 100000, monthlyBudgetCents: 10000 });
  const history = [spend(9000, minutesAgo(3 * 24 * 60))];
  assert.equal(evaluate(m, proposal({ amountCents: 1500 }), history, NOW).reasons[0].code, 'OVER_MONTHLY_BUDGET');
});

test('too many auto approvals in an hour forces a human, and human approvals do not count', () => {
  const m = mandate({ maxAutoApprovalsPerHour: 2 });
  const two = [spend(500, minutesAgo(10)), spend(500, minutesAgo(20))];
  assert.equal(evaluate(m, proposal(), two, NOW).reasons[0].code, 'AUTO_APPROVAL_RATE_LIMIT');
  const withHumans = [spend(500, minutesAgo(10), 'human'), spend(500, minutesAgo(20), 'human')];
  assert.equal(evaluate(m, proposal(), withHumans, NOW).outcome, 'auto_approve');
});

test('lifecycle: the happy path and the human path', () => {
  assert.equal(next('proposed', 'policy_approved'), 'awaiting_buyer');
  assert.equal(next('awaiting_buyer', 'buyer_approved_and_authorized'), 'authorized');
  assert.equal(next('authorized', 'captured'), 'captured');
  assert.equal(next('proposed', 'policy_needs_human'), 'awaiting_human');
  assert.equal(next('awaiting_human', 'human_approved'), 'awaiting_buyer');
  assert.equal(next('awaiting_human', 'human_rejected'), 'rejected');
});

test('lifecycle: nothing skips the human or the authorization', () => {
  assert.equal(next('awaiting_human', 'captured'), undefined);
  assert.equal(next('awaiting_human', 'buyer_approved_and_authorized'), undefined);
  assert.equal(next('proposed', 'captured'), undefined);
  assert.equal(next('denied', 'human_approved'), undefined);
  assert.equal(next('captured', 'voided'), undefined);
  assert.equal(next('authorized', 'voided'), 'voided');
});

test('money conversion round trips and rejects junk', () => {
  assert.equal(toCents('12.99'), 1299);
  assert.equal(toCents('12.5'), 1250);
  assert.equal(toCents('7'), 700);
  assert.equal(toCents('-1'), undefined);
  assert.equal(toCents('1.234'), undefined);
  assert.equal(toCents('abc'), undefined);
  assert.equal(toDecimalString(1299), '12.99');
  assert.equal(toDecimalString(5), '0.05');
  assert.equal(toDecimalString(700), '7.00');
});
