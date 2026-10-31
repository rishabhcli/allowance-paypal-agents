// The AG Studio assistant, extended with an agent of our own. Studio ships a team of agents for building
// dashboards (lead, data, page, planning, widget). Allowance adds a "treasurer" that sits in front of
// them: it answers questions about agent spending with Studio's query tool, hands dashboard edits to the
// built-in agents, and can change spending mandates through tools we define.
//
// The mandate tools follow one rule: an agent may tighten limits on its own, but loosening one (raising a
// limit or resuming a paused mandate) needs a person to confirm in the browser. That confirmation is a
// real window.confirm in `execute`, so the model cannot talk its way past it.
//
// The adapter calls `${endpoint}/responses`, i.e. this app's proxy at app/api/ai/responses, which holds the
// Fireworks key, so nothing secret is sent from the browser.

import {
  createAiHarness,
  directLlmRunner,
  type AgAiHarnessSetup,
  type AgAiPromptStarter,
  type AgStudioApi,
} from 'ag-studio';
import { openaiAdapter } from './openai-adapter';

const PROMPT_STARTERS: AgAiPromptStarter[] = [
  { label: 'Why was money stopped?', prompt: 'Which purchases were stopped and why? Group by reason and show the amount stopped for each.' },
  { label: 'Pause an agent', prompt: 'office-restock keeps asking for things above its limit. Pause it.' },
  { label: 'Add a retailer chart', prompt: 'Add a chart of the money approved or waiting for a person, by retailer.' },
];

type Mandate = {
  id: string;
  agent: string;
  paused: boolean;
  perPurchaseCapCents: number;
  autoApproveUpToCents: number;
  dailyBudgetCents: number;
};

const usd = (cents: number) => `$${(cents / 100).toFixed(2)}`;
const LIMITS = {
  perPurchaseCap: 'perPurchaseCapCents',
  autoApproveLimit: 'autoApproveUpToCents',
  dailyBudget: 'dailyBudgetCents',
} as const;

async function mandates(signal?: AbortSignal): Promise<Mandate[]> {
  const res = await fetch('/api/mandates', { signal });
  if (!res.ok) throw new Error(`Mandates request failed (${res.status})`);
  return res.json();
}

async function patch(id: string, body: object, signal?: AbortSignal) {
  const res = await fetch('/api/mandates', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id, ...body }), signal });
  if (!res.ok) throw new Error(`Update failed (${res.status})`);
  window.dispatchEvent(new Event('allowance:mandates-changed'));
}

function mandateTools(api: AgStudioApi) {
  const listMandates = api.defineAiTool({
    name: 'list_mandates',
    description: 'List every agent mandate with its limits and whether it is paused. Amounts are in US dollars.',
    params: (s) => s.object({}),
    execute: async (_args, ctx) => {
      const rows = (await mandates(ctx.signal)).map((m) => ({
        agent: m.agent,
        state: m.paused ? 'paused' : 'active',
        perPurchaseCap: usd(m.perPurchaseCapCents),
        autoApproveLimit: usd(m.autoApproveUpToCents),
        dailyBudget: usd(m.dailyBudgetCents),
      }));
      return ctx.success(`${rows.length} mandates.`, { mandates: rows });
    },
  });

  const pauseMandate = api.defineAiTool({
    name: 'pause_mandate',
    description: 'Pause an agent mandate. A paused agent can still propose purchases but every one is denied. Use when asked to stop an agent spending.',
    params: (s) => s.object({ agent: s.string({ description: 'The agent name, e.g. office-restock.' }) }),
    execute: async (args, ctx) => {
      const m = (await mandates(ctx.signal)).find((x) => x.agent === args.agent);
      if (!m) return ctx.error(`No agent named ${args.agent}. Use list_mandates to see the names.`);
      await patch(m.id, { paused: true }, ctx.signal);
      return ctx.success(`${m.agent} is paused. Its next purchases will be denied until a person resumes it.`);
    },
  });

  const resumeMandate = api.defineAiTool({
    name: 'resume_mandate',
    description: 'Resume a paused mandate. Loosens spending, so a person is asked to confirm in the browser first.',
    params: (s) => s.object({ agent: s.string({ description: 'The agent name.' }) }),
    execute: async (args, ctx) => {
      const m = (await mandates(ctx.signal)).find((x) => x.agent === args.agent);
      if (!m) return ctx.error(`No agent named ${args.agent}.`);
      if (!window.confirm(`Resume ${m.agent}? It will be able to spend within its mandate again.`)) return ctx.error('The person declined. Do not retry.');
      await patch(m.id, { paused: false }, ctx.signal);
      return ctx.success(`${m.agent} is active again.`);
    },
  });

  const setLimit = api.defineAiTool({
    name: 'set_mandate_limit',
    description:
      'Change one limit of a mandate, in US dollars. Lowering a limit applies at once. Raising one asks a person to confirm in the browser first.',
    params: (s) =>
      s.object({
        agent: s.string({ description: 'The agent name.' }),
        limit: s.enum(['perPurchaseCap', 'autoApproveLimit', 'dailyBudget']),
        dollars: s.number({ description: 'The new value in US dollars, a whole number.' }),
      }),
    execute: async (args, ctx) => {
      const m = (await mandates(ctx.signal)).find((x) => x.agent === args.agent);
      if (!m) return ctx.error(`No agent named ${args.agent}.`);
      const key = LIMITS[args.limit as keyof typeof LIMITS];
      const next = Math.round(args.dollars) * 100;
      if (next < 0) return ctx.error('A limit cannot be negative.');
      if (next > m[key]) {
        const ok = window.confirm(`Raise ${m.agent}'s ${args.limit} from ${usd(m[key])} to ${usd(next)}?`);
        if (!ok) return ctx.error('The person declined to raise the limit. Do not retry.');
      }
      await patch(m.id, { [key]: next }, ctx.signal);
      return ctx.success(`${m.agent} ${args.limit} is now ${usd(next)} (was ${usd(m[key])}).`);
    },
  });

  return [listMandates, pauseMandate, resumeMandate, setLimit];
}

// `models` are the ids allowed by AI_MODELS on the server; the first is the default, and the picker only
// shows for two or more.
export function buildAi(models: string[]): AgAiHarnessSetup {
  const adapter = openaiAdapter({ endpoint: '/api/ai', model: models[0] });

  return ({ api }) =>
    createAiHarness(api, ({ tools, builtIn }) => {
      const treasurer = directLlmRunner({
        id: 'treasurer',
        adapter,
        description: 'Answers questions about agent spending and manages spending mandates.',
        instructions: () =>
          [
            'You are the treasurer for a group of AI shopping agents. Each agent works under a mandate: a per purchase cap, an amount it may spend alone, and a daily budget.',
            'Every purchase an agent proposes is decided by policy (approved, held for a person, or denied). Use the data tools to answer questions with numbers from the dashboard data, not guesses.',
            'To change a spending limit or pause an agent, use the mandate tools. Only do so when the user asks. Say exactly what changed.',
            'Raising a limit or resuming an agent needs the person to confirm in the browser; if they decline, accept it and do not try again.',
            'To add or change charts, widgets or pages, delegate to the built-in agents.',
            'Money is in US dollars. Keep replies short.',
          ].join('\n'),
        tools: () => [
          tools.studio.viewSchema(),
          tools.studio.executeQuery(),
          ...mandateTools(api),
          tools.delegateTo(['data', 'page', 'planning', 'widget']),
        ],
      });
      return {
        agents: [treasurer, ...(['data', 'page', 'planning', 'widget'] as const).map((id) => directLlmRunner({ ...builtIn[id], adapter }))],
        primary: 'treasurer',
        promptStarters: PROMPT_STARTERS,
        models: models.length > 1 ? models.map((id) => ({ id, label: id })) : undefined,
      };
    });
}
