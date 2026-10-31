// The built-in "Agent spend" report: three pages (spend, limits, audit trail) as AG Studio report
// state. Field ids ('purchases.requested') refer to the data sources in ./data.ts.

import type { AgPageState, AgReportState, AgWidgetLayoutState } from 'ag-studio';

// Position on the canvas grid, in tracks: 24 columns wide, rows of studioCanvasRowHeight.
const at = (xTrack: number, yTrack: number, xSpan: number, ySpan: number): AgWidgetLayoutState => ({ xTrack, yTrack, xSpan, ySpan });
const title = (text: string) => ({ title: { enabled: true, text } });
const sum = (id: string) => ({ id, aggregation: 'sum' as const });
const countd = (id: string) => ({ id, aggregation: 'countd' as const });

// Same stack as --pp-font in app/globals.css.
const FONT = '"Helvetica Neue", Helvetica, Arial, sans-serif';

const typography = (fontSize: number, fontWeight: 'normal' | 'bold' = 'normal') => ({
  fontFamily: FONT,
  fontSize,
  fontWeight,
  fontStyle: 'normal' as const,
});

// A KPI tile: bold title, large value, optional sparkline along `sparklineX`.
const kpi = (text: string, value: { id: string; aggregation?: 'sum' | 'avg' | 'countd' }, sparklineX?: string) => ({
  type: 'value' as const,
  dataMapping: { value: [value], ...(sparklineX && { sparklineX: [{ id: sparklineX }] }) },
  format: {
    title: { enabled: true, text, typography: typography(14, 'bold') },
    caption: { enabled: true, text: '', typography: typography(0) },
    style: { typography: typography(22) },
  },
});

const spend: AgPageState = {
  id: 'spend',
  widgets: {
    agent: {
      type: 'button-filter',
      dataMapping: { value: [{ id: 'mandates.agent' }] },
      format: { ...title('Agent'), style: { selection: { type: 'multiple' }, dimensions: { height: 28, minWidth: 48 } } },
    },
    'kpi-requested': kpi('Requested ($)', sum('purchases.requested'), 'calendar::day'),
    'kpi-committed': kpi('Approved ($)', sum('purchases.committed'), 'calendar::day'),
    'kpi-waiting': kpi('Waiting ($)', sum('purchases.waiting')),
    'kpi-stopped': kpi('Stopped ($)', sum('purchases.stopped')),
    'spend-by-agent': {
      type: 'column-chart-stacked',
      dataMapping: {
        categoryKey: [{ id: 'mandates.agent' }],
        valueKey: [countd('purchases.id')],
        legendKey: [{ id: 'purchases.statusGroup' }],
      },
      format: { ...title('Purchases each agent proposed, by where they ended up'), style: { theme: { common: { legend: { enabled: true } } } } },
    },
    'decision-donut': {
      type: 'donut-chart',
      dataMapping: { categoryKey: [{ id: 'purchases.outcome' }], valueKey: [countd('purchases.id')] },
      format: { ...title('Policy decisions'), style: { custom: { pieDataLabel: { enabled: true }, totalLabel: { enabled: true } } } },
    },
    'merchant-treemap': {
      type: 'treemap-chart',
      dataMapping: { categoryKey: [{ id: 'purchases.category' }, { id: 'purchases.merchant' }], valueKey: [sum('purchases.exposure')] },
      format: title('Money approved or waiting for a person, by category and retailer'),
    },
    purchases: {
      type: 'grid',
      dataMapping: {
        cols: [
          { id: 'purchases.createdAt' },
          { id: 'mandates.agent' },
          { id: 'purchases.title' },
          { id: 'purchases.merchant' },
          { id: 'purchases.statusGroup' },
          { id: 'purchases.reason' },
          { id: 'purchases.approvedBy' },
          sum('purchases.requested'),
          sum('purchases.committed'),
        ],
      },
      sort: [{ field: { id: 'purchases.createdAt' }, direction: 'desc' }],
      format: title('Every purchase an agent proposed'),
    },
  },
  widgetLayout: {
    'kpi-requested': at(0, 0, 4, 7),
    'kpi-committed': at(4, 0, 4, 7),
    'kpi-waiting': at(8, 0, 4, 7),
    'kpi-stopped': at(12, 0, 4, 7),
    agent: at(16, 0, 8, 7),
    'spend-by-agent': at(0, 7, 14, 17),
    'decision-donut': at(14, 7, 10, 17),
    'merchant-treemap': at(0, 24, 10, 17),
    purchases: at(10, 24, 14, 17),
  },
};

const limits: AgPageState = {
  id: 'limits',
  widgets: {
    'kpi-auto': { ...kpi('Approved by policy alone', { id: 'autoShare' }), },
    'kpi-stop': { ...kpi('Stopped rate', { id: 'stopRate' }) },
    'kpi-mandates': kpi('Mandates', countd('mandates.id')),
    'budget-use': {
      type: 'bar-chart-grouped',
      dataMapping: {
        categoryKey: [{ id: 'mandates.agent' }],
        valueKey: [sum('mandates.spentToday'), sum('mandates.dailyBudget'), sum('mandates.perPurchaseCap')],
      },
      format: { ...title('Spent in the last 24 hours against the daily budget and the per purchase cap'), style: { theme: { common: { legend: { enabled: true, position: 'bottom' } } } } },
    },
    'daily-gauge': {
      type: 'radial-gauge',
      dataMapping: { value: [{ id: 'dailyUse' }] },
      format: {
        ...title('Daily budget used, all agents'),
        style: { scaleLabel: { min: 0, max: 1 }, label: { typography: typography(24, 'bold') }, secondaryLabel: { enabled: true, text: 'of the combined daily budgets', typography: typography(12) } },
      },
    },
    'reason-bars': {
      type: 'bar-chart-grouped',
      dataMapping: { categoryKey: [{ id: 'purchases.reason' }], valueKey: [countd('purchases.id')] },
      format: title('Why purchases were approved, held or denied'),
    },
    'reason-pivot': {
      type: 'pivot-grid',
      dataMapping: { rows: [{ id: 'purchases.outcome' }, { id: 'purchases.reason' }], columns: [{ id: 'mandates.agent' }], values: [countd('purchases.id')] },
      format: { style: { totalColumns: true, totalColumnsPlacement: 'after', grandTotalRow: { enabled: true } } },
    },
    mandates: {
      type: 'grid',
      dataMapping: {
        cols: [
          { id: 'mandates.agent' },
          { id: 'mandates.state' },
          sum('mandates.perPurchaseCap'),
          sum('mandates.autoApproveLimit'),
          sum('mandates.dailyBudget'),
          sum('mandates.spentToday'),
        ],
      },
      format: title('Mandates and their limits'),
    },
  },
  widgetLayout: {
    'kpi-auto': at(0, 0, 8, 7),
    'kpi-stop': at(8, 0, 8, 7),
    'kpi-mandates': at(16, 0, 8, 7),
    'budget-use': at(0, 7, 14, 17),
    'daily-gauge': at(14, 7, 10, 17),
    'reason-bars': at(0, 24, 10, 17),
    'reason-pivot': at(10, 24, 14, 17),
    mandates: at(0, 41, 24, 12),
  },
};

const audit: AgPageState = {
  id: 'audit',
  widgets: {
    'kpi-events': kpi('Audit events', countd('events.id')),
    'kpi-purchases': kpi('Purchases', countd('purchases.id')),
    'event-donut': {
      type: 'donut-chart',
      dataMapping: { categoryKey: [{ id: 'events.event' }], valueKey: [countd('events.id')] },
      format: { ...title('Steps recorded'), style: { custom: { pieDataLabel: { enabled: true }, totalLabel: { enabled: true } } } },
    },
    trail: {
      type: 'grid',
      dataMapping: {
        cols: [{ id: 'events.at' }, { id: 'purchases.title' }, { id: 'purchases.merchant' }, { id: 'events.event' }, { id: 'events.note' }],
      },
      sort: [{ field: { id: 'events.at' }, direction: 'desc' }],
      format: title('Audit trail'),
    },
  },
  widgetLayout: {
    'kpi-events': at(0, 0, 6, 7),
    'kpi-purchases': at(6, 0, 6, 7),
    'event-donut': at(12, 0, 12, 14),
    trail: at(0, 14, 24, 30),
  },
};

// The report opens on its first page.
export const dashboardReport: AgReportState = {
  selectedPageId: spend.id,
  pages: [spend, limits, audit],
};
