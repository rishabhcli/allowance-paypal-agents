# Devpost text for Allowance

Paste each block into the matching Devpost field. Replace `<YOUTUBE_URL>` once the video is public.

## Project name

Allowance

## Tagline (short)

Spending mandates and human approval for AI shopping agents, on the PayPal sandbox

## Elevator pitch (if a second short field exists)

An AI agent that can buy things needs limits the model cannot argue with. Allowance puts a policy engine between the agent and PayPal: small purchases go through, larger ones wait for a person, and anything outside the mandate is refused before PayPal is called.

## Description

### The problem

More agents are being given the ability to spend money. Today the limits usually live in the prompt, which a model can ignore or be talked out of. A person who lets an agent shop needs three things: limits that are enforced outside the model, a way to approve the larger purchases, and a record of every decision.

### What Allowance does

Each agent works under a mandate: a cap per purchase, an amount it may spend alone, and a daily budget (with optional monthly budget, merchant and category lists, and an hourly limit on auto approvals). An agent is given an errand in plain words. It searches real products, picks one, and proposes a purchase. A policy engine then decides:

- Inside every limit: the purchase is approved and PayPal places an authorization hold (Orders v2 with intent AUTHORIZE).
- Above what the agent may spend alone: the purchase waits in an approvals queue for a person, who can approve or reject it.
- Outside the mandate (over the cap, over budget, paused agent, blocked merchant): it is denied before PayPal is called.

Money only moves at capture. A person can capture the full amount or a lower final price, or void the hold. PayPal webhooks reconcile captures and voids, and every step is written to an audit log.

An AG Studio dashboard reads the same data: agent spend and where each purchase ended up, mandates and limits, and the audit trail. Inside Studio, a custom treasurer agent can answer questions about spending, hand chart and page edits to Studio's built-in agents, and change mandates through four tools of its own (list, pause, resume, set limit). The treasurer can tighten a limit on its own. Raising a limit or resuming an agent opens a browser confirmation that a person must accept.

### How it was built

- Next.js and TypeScript. The server talks to PayPal's sandbox REST API with plain fetch (Orders v2 create, authorize, capture and void, `PayPal-Request-Id` on every write, webhook signature verification through `/v1/notifications/verify-webhook-signature`).
- The policy engine (`lib/allowance/policy.ts`) is pure functions with no I/O, tested on its own. The purchase workflow (`service.ts`) and the agent (`agent.ts`) are tested with PayPal and the model mocked at the fetch boundary. 32 tests run offline with `npm test`.
- The shopping agent runs on gpt-oss-120b served by Fireworks, with tool calling (`search_products`, `propose_purchase`). It never sees the mandate limits. The server looks each proposed offer up in the results the agent just searched, so price and merchant come from the catalog and the model cannot set them.
- The hosted demo runs on Vercel. Because serverless instances do not share a disk, the hosted state is kept in a private Vercel Blob. Locally it is a JSON file.
- The project started from PayPal's open AG Grid boilerplate for the Next.js shell and Studio wiring. The policy engine, PayPal order flow, agent, Channel3 client, API routes, webhook handler, approvals page, Studio data model, report, treasurer agent, tests and scripts are new. The boilerplate's read-only PayPal pages were removed.

### Sponsor tools and how each is used

**AG Grid (AG Studio).** The dashboard is an AG Studio report over three tables (mandates, purchases, audit events) with relationships, a calendar, calculated measures (approved by policy share, stopped rate, daily budget used) and three pages. It uses a custom theme driven by one set of design tokens shared by the shell, Studio, grids and charts. The treasurer is a custom agent added to Studio's agent team through the Studio Agent Framework: it uses Studio's own query tool, delegates to the built-in data, page, planning and widget agents, and defines four tools of its own with `api.defineAiTool`. It runs on the same Fireworks model through a proxy that keeps the key on the server.

**Channel3.** Every product the agent can propose comes from Channel3's `/v1/search`, flattened to one candidate per in-stock retailer offer. Without the key the agent has nothing to buy.

No other sponsor tools are used.

### AI tools and models

- gpt-oss-120b on Fireworks: the shopping agent and the AG Studio assistant (including the treasurer).
- Claude Code (Anthropic) was used to write and test the code in this repository.

### What the ablation shows

The same agent, model, errands and PayPal sandbox were run once under the demo mandate and once with limits so wide they never bind (`npm run ablation`, table in `docs/ablation.md`). Money authorized with no person involved was $53.98 with the policy engine and $27,870.73 without it. The unguarded agent authorized a $27,375.00 luxury watch and a $262.73 jacket. With the engine on, both were denied, and the agent proposed cheaper alternatives, one of which waited for a person. Search results vary between runs, so the exact items differ.

### Challenges

- Keeping the model out of the money path. The first design let the model state a price. The final one has the server resolve every proposal against the catalog results, and the tests include an agent that tries to smuggle in its own price.
- Making loosening a limit a human decision even when the treasurer agent is the one asking. The confirmation lives in the tool's `execute`, so it cannot be skipped by the model.
- Serverless state. Capture failed when a request landed on a different instance than the order, which moved the hosted state to a shared blob.

### What is and is not demonstrated

- Demonstrated against the live PayPal sandbox: order creation with intent AUTHORIZE, authorization, full and partial capture, void, and a real PAYMENT.CAPTURE.COMPLETED webhook delivered to the hosted app, signature verified by PayPal and recorded in the audit log.
- Funding in the demo is a PayPal sandbox test card, a stand in for a card an agent holds. The wallet path (the order stops at PayPal's approval URL and is authorized after the buyer returns) is implemented but was not exercised, because no sandbox buyer login was available.
- PayPal's own agentic commerce products were not used because they are invite only.
- The hosted state is one JSON blob that handlers read before and write after each request. Simultaneous writes would race (last one wins). That is acceptable for a demo and not for production.
- The AG Studio licence is a 45 day trial. Agent runs on the hosted demo are rate limited.

### What is next

- Exercise the wallet approval path with a sandbox buyer account.
- Per merchant and per category budgets in the dashboard editor, and expiry on mandates from the UI.
- A real database in place of the blob, and per user mandates.

## Built with (tags)

nextjs, typescript, react, paypal, paypal-orders-api, ag-grid, ag-studio, channel3, fireworks-ai, gpt-oss, vercel, vercel-blob, tailwindcss, node.js

## Links

- Try it out (hosted): https://allowance-paypal-agents.vercel.app
- Code: https://github.com/rishabhcli/allowance-paypal-agents (public, MIT)
- Video: `<YOUTUBE_URL>`

## Testing instructions (for the judges field)

No login is needed. Open https://allowance-paypal-agents.vercel.app.

1. On Approvals, press Run agent. The agent searches Channel3 and proposes a purchase. A small one is approved by policy and shows up under Holds on PayPal. Capture takes the money (sandbox), Void releases it.
2. Under Waiting for you, approve or reject a purchase the policy held for a person. Recent activity shows what was denied and why.
3. Open Dashboard for the AG Studio report. Choose Edit, open the AI Assistant panel and ask the treasurer to pause an agent. The mandate on the Approvals page changes.

Everything uses the PayPal sandbox and no real money moves. Agent runs on the hosted demo are rate limited. To run it yourself, see the README: `npm install`, copy `env.example` to `.env.local` and fill in a PayPal sandbox app, a Channel3 key, a Fireworks key and an AG Studio trial licence, then `npm run dev`. `npm test` needs no network.

## Sponsor prize opt-in checklist (Devpost form)

- Opt in: Best Use of AG Grid (primary), Best Use of Channel3.
- Do not opt in: Render, APIMatic, Bryntum, Astropods, Elastic, KERNEL, Postman, Zapier.
- Rules allow one sponsor prize plus one grand or honorable mention prize per project.

## Suggested images (in this order)

1. `01-agent-run.png` the agent run with its steps
2. `02-waiting-for-you.png` the approvals queue
3. `05-dashboard-spend.png` the AG Studio report
4. `08-treasurer-pauses-agent.png` the treasurer agent
5. `09-ablation.png` the ablation numbers
