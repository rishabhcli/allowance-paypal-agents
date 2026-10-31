// AG Studio's data sources for the Allowance dashboard: one table each for mandates, purchases and
// audit events, the relationships between them, a calendar, and the calculated measures.

import type { AgDataSourcesDefinition, AgExpressionFieldDefinition, AgFieldDefinition, AgFormat, AgRelationDefinition } from 'ag-studio';
import type { DashboardData } from '@/lib/dashboard-data';

const CALENDAR_ID = 'calendar';

// [id, name, format, hide?]
type FieldSpec = [id: string, name: string, format: AgFormat, hide?: boolean];

const fields = (specs: FieldSpec[]): AgFieldDefinition[] =>
  specs.map(([id, name, format, hide]) => ({ id, name, format, ...(hide && { hide }) }));

const manyToOne = (id: string, source: string, target: string): AgRelationDefinition => {
  const [sourceTable, sourceField] = source.split('.');
  const [targetTable, targetField] = target.split('.');
  return { id, source: { tableId: sourceTable, fieldId: sourceField }, target: { tableId: targetTable, fieldId: targetField }, type: 'many-to-one' };
};

const onCalendar = (tableId: string, fieldId: string, truncate?: 'day'): AgRelationDefinition => ({
  id: `${tableId}-${fieldId}-calendar`,
  source: { tableId, fieldId },
  target: { calendarId: CALENDAR_ID },
  ...(truncate && { truncate }),
});

const sumOf = (id: string) => ({ id, aggregation: 'sum' as const });

const ratio = (id: string, name: string, description: string, numerator: string, denominator: string): AgExpressionFieldDefinition => ({
  id,
  name,
  description,
  format: 'percentageFormat',
  isMeasure: true,
  expression: { operator: 'divide', inputs: [sumOf(numerator), sumOf(denominator)] },
});

export const hasData = (data: DashboardData) => data.purchases.length > 0 || data.mandates.length > 0;

export function buildStudioData(data: DashboardData): AgDataSourcesDefinition {
  const dates = data.purchases.map((r) => r.createdDate).sort();
  const today = data.asOf.slice(0, 10);

  return {
    description:
      'Spending of AI shopping agents on the PayPal sandbox. Each agent works under a mandate (a per purchase cap, an amount it may spend on its own, ' +
      'a daily and monthly budget). Every purchase an agent proposes is decided by policy: approved, held for a person, or denied. ' +
      'Money is in US dollars. "Requested" is what the agent asked for; "Committed" is what PayPal holds or has captured.',
    sources: [
      {
        id: 'mandates',
        description: 'One row per agent mandate with its limits. Spent today is money authorized or captured in the last 24 hours.',
        data: data.mandates,
        fields: fields([
          ['id', 'Mandate ID', 'textFormat', true],
          ['agent', 'Agent', 'textFormat'],
          ['state', 'Mandate State', 'textFormat'],
          ['perPurchaseCap', 'Per Purchase Cap', 'currencyFormat'],
          ['autoApproveLimit', 'Auto Approve Limit', 'currencyFormat'],
          ['dailyBudget', 'Daily Budget', 'currencyFormat'],
          ['monthlyBudget', 'Monthly Budget', 'currencyFormat'],
          ['spentToday', 'Spent Today', 'currencyFormat'],
        ]),
      },
      {
        id: 'purchases',
        description:
          'One row per purchase an agent proposed. Status group says where it ended up. Requested is the price; committed counts only authorized or captured money; stopped counts purchases denied by policy or rejected by a person.',
        data: data.purchases,
        fields: fields([
          ['id', 'Purchase ID', 'textFormat', true],
          ['mandateId', 'Mandate ID', 'textFormat', true],
          ['title', 'Item', 'textFormat'],
          ['merchant', 'Merchant', 'textFormat'],
          ['category', 'Category', 'textFormat'],
          ['createdAt', 'Proposed At', 'dateTimeFormat'],
          ['createdDate', 'Proposed On', 'dateFormat'],
          ['requested', 'Requested', 'currencyFormat'],
          ['committed', 'Committed', 'currencyFormat'],
          ['captured', 'Captured', 'currencyFormat'],
          ['waiting', 'Waiting for a Person', 'currencyFormat'],
          ['exposure', 'Approved or Waiting', 'currencyFormat'],
          ['stopped', 'Stopped', 'currencyFormat'],
          ['one', 'Purchases', 'integerFormat', true],
          ['isAuto', 'Auto Approved Flag', 'integerFormat', true],
          ['isHeld', 'Human Decision Flag', 'integerFormat', true],
          ['isStopped', 'Stopped Flag', 'integerFormat', true],
          ['statusGroup', 'Status', 'textFormat'],
          ['outcome', 'Policy Decision', 'textFormat'],
          ['reason', 'Reason', 'textFormat'],
          ['approvedBy', 'Approved By', 'textFormat'],
        ]),
      },
      {
        id: 'events',
        name: 'Audit Events',
        description: 'The audit trail: every step a purchase went through, with the note recorded at that step.',
        data: data.events,
        fields: fields([
          ['id', 'Event ID', 'textFormat', true],
          ['purchaseId', 'Purchase ID', 'textFormat', true],
          ['at', 'Event Time', 'dateTimeFormat'],
          ['event', 'Event', 'textFormat'],
          ['note', 'Note', 'textFormat'],
        ]),
      },
    ],
    relationships: [
      manyToOne('purchase-mandate', 'purchases.mandateId', 'mandates.id'),
      manyToOne('event-purchase', 'events.purchaseId', 'purchases.id'),
      onCalendar('purchases', 'createdAt', 'day'),
    ],
    calendars: [
      {
        id: CALENDAR_ID,
        label: 'Calendar',
        range: { from: { type: 'date', value: dates[0] ?? today }, to: { type: 'date', value: dates.at(-1) ?? today } },
        fragments: ['year', 'month', 'week', 'day', 'dayOfWeek'],
      },
    ],
    expressions: [
      ratio('autoShare', 'Approved By Policy Share', 'Purchases approved by policy with no person involved, as a share of all purchases.', 'purchases.isAuto', 'purchases.one'),
      ratio('stopRate', 'Stopped Rate', 'Purchases denied by policy or rejected by a person, as a share of all purchases.', 'purchases.isStopped', 'purchases.one'),
      ratio('dailyUse', 'Daily Budget Used', 'Spent today as a share of the daily budget.', 'mandates.spentToday', 'mandates.dailyBudget'),
    ],
  };
}
