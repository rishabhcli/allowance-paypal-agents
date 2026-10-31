// The shopping agent. A Fireworks-hosted open model (gpt-oss-120b by default) runs a tool-calling loop:
// it searches Channel3 and asks to buy. It never sees the mandate limits and never sets a price. The
// server looks the offer up in the results it just returned, so the amount and merchant come from
// Channel3, then hands the proposal to the policy engine.

import { searchProducts as channel3Search, type Candidate } from './channel3.ts';
import { submitProposal } from './service.ts';
import type { Purchase } from './store.ts';

const ENDPOINT = 'https://api.fireworks.ai/inference/v1/chat/completions';
export const AGENT_MODEL = process.env.AGENT_MODEL ?? 'accounts/fireworks/models/gpt-oss-120b';
const MAX_TURNS = 6;

type ToolCall = { id: string; function: { name: string; arguments: string } };
type Message =
  | { role: 'system' | 'user'; content: string }
  | { role: 'assistant'; content: string | null; tool_calls?: ToolCall[] }
  | { role: 'tool'; tool_call_id: string; content: string };

const TOOLS = [
  {
    type: 'function',
    function: {
      name: 'search_products',
      description: 'Search the product catalog. Returns offers: one row per retailer with its price in USD.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'What to look for, in plain words.' },
          max_price_dollars: { type: 'number', description: 'Optional price ceiling.' },
        },
        required: ['query'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'propose_purchase',
      description:
        'Ask to buy one offer from the latest search results. A spending policy decides what happens. Returns the decision.',
      parameters: {
        type: 'object',
        properties: {
          product_id: { type: 'string' },
          merchant: { type: 'string', description: 'The retailer domain exactly as listed in the search results.' },
          rationale: { type: 'string', description: 'One or two sentences on why this is the right buy.' },
        },
        required: ['product_id', 'merchant', 'rationale'],
      },
    },
  },
];

export type AgentRun = {
  messages: { role: string; text: string }[];
  purchases: Purchase[];
  turns: number;
};

export type AgentDeps = {
  search?: (query: string, opts: { maxPriceDollars?: number }) => Promise<Candidate[]>;
  chat?: (messages: Message[]) => Promise<{ content: string | null; tool_calls?: ToolCall[] }>;
};

async function fireworksChat(messages: Message[]) {
  const key = process.env.FIREWORKS_API_KEY;
  if (!key) throw new Error('FIREWORKS_API_KEY is not set');
  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: AGENT_MODEL, messages, tools: TOOLS, tool_choice: 'auto', temperature: 0.2, max_tokens: 1200 }),
  });
  if (!res.ok) throw new Error(`Fireworks ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const json = (await res.json()) as { choices: { message: { content: string | null; tool_calls?: ToolCall[] } }[] };
  return json.choices[0].message;
}

export async function runAgent(mandateId: string, goal: string, deps: AgentDeps = {}): Promise<AgentRun> {
  const search = deps.search ?? ((q, o) => channel3Search(q, o));
  const chat = deps.chat ?? fireworksChat;
  const seen = new Map<string, Candidate>(); // `${productId}|${domain}` -> offer, from this run's searches
  const purchases: Purchase[] = [];
  const messages: Message[] = [
    {
      role: 'system',
      content:
        `You are the shopping agent "${mandateId}". Find what the user asks for using search_products, pick the single best offer ` +
        `(price, retailer, fit), and call propose_purchase once. A spending policy outside your control approves, holds for a person, ` +
        `or denies each proposal. If it is denied or held, say so plainly and do not try to get around it; you may propose one cheaper ` +
        `alternative if the denial was about price. Finish with a short plain summary. Only buy what the user asked for.`,
    },
    { role: 'user', content: goal },
  ];
  const transcript: AgentRun['messages'] = [{ role: 'user', text: goal }];

  let turns = 0;
  while (turns < MAX_TURNS) {
    turns++;
    const reply = await chat(messages);
    messages.push({ role: 'assistant', content: reply.content ?? null, tool_calls: reply.tool_calls });
    if (reply.content) transcript.push({ role: 'assistant', text: reply.content });
    if (!reply.tool_calls?.length) break;

    for (const call of reply.tool_calls) {
      let result: unknown;
      try {
        const args = JSON.parse(call.function.arguments || '{}') as Record<string, unknown>;
        if (call.function.name === 'search_products') {
          const found = await search(String(args.query ?? ''), { maxPriceDollars: typeof args.max_price_dollars === 'number' ? args.max_price_dollars : undefined });
          for (const c of found) seen.set(`${c.productId}|${c.merchant}`, c);
          result = found.map((c) => ({ product_id: c.productId, merchant: c.merchant, title: c.title, brand: c.brand, price_usd: c.priceCents / 100 }));
          transcript.push({ role: 'tool', text: `search "${args.query}": ${found.length} offers` });
        } else if (call.function.name === 'propose_purchase') {
          const offer = seen.get(`${String(args.product_id)}|${String(args.merchant)}`);
          if (!offer) {
            result = { error: 'That product and merchant were not in your search results. Search first, then use an offer exactly as listed.' };
          } else {
            const p = await submitProposal({
              mandateId,
              productId: offer.productId,
              title: offer.title,
              merchant: offer.merchant,
              category: offer.category,
              amountCents: offer.priceCents,
              currency: offer.currency,
              buyUrl: offer.buyUrl,
              rationale: String(args.rationale ?? ''),
            });
            purchases.push(p);
            result = { status: p.status, decision: p.decision.outcome, reason: p.decision.reasons[0]?.detail };
            transcript.push({ role: 'tool', text: `propose ${offer.title} @ ${offer.merchant}: ${p.decision.outcome}` });
          }
        } else {
          result = { error: `Unknown tool ${call.function.name}` };
        }
      } catch (err) {
        result = { error: err instanceof Error ? err.message : String(err) };
      }
      messages.push({ role: 'tool', tool_call_id: call.id, content: JSON.stringify(result) });
    }
  }
  return { messages: transcript, purchases, turns };
}
