// Live end-to-end run against real services: Channel3 search, a Fireworks model, the PayPal sandbox.
//   npm run demo -- "Find warm hiking socks under $40 as a gift"
// Needs .env.local (see env.example). Prints what the agent did and what PayPal holds.
import { runAgent } from '../lib/allowance/agent.ts';
import { capture } from '../lib/allowance/service.ts';

const goal = process.argv[2] ?? 'Find a pair of warm merino hiking socks under $40 as a gift.';
const mandateId = process.argv[3] ?? 'gift-finder';
const run = await runAgent(mandateId, goal);
for (const m of run.messages) console.log(`[${m.role}] ${m.text}`);
for (const p of run.purchases) {
  console.log(`\n${p.title} @ ${p.merchant}: $${(p.amountCents / 100).toFixed(2)} -> ${p.status} (${p.decision.outcome}: ${p.decision.reasons[0].detail})`);
  if (p.status === 'authorized') {
    const settled = await capture(p.id, p.amountCents - 100);
    console.log(`  captured $${((settled.capturedCents ?? 0) / 100).toFixed(2)} of the $${(p.amountCents / 100).toFixed(2)} hold, PayPal capture ${settled.captureId}`);
  }
}
