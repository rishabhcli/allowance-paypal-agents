import { NextResponse } from 'next/server';
import { runAgent } from '@/lib/allowance/agent';
import { allow, clientKey } from '@/lib/allowance/limits';
import { getMandate } from '@/lib/allowance/store';

export const maxDuration = 60;

export async function POST(req: Request) {
  // Each run costs model calls and creates a PayPal sandbox order: cap it per client and per day.
  if (!allow(`run:${clientKey(req)}`, 10, 60 * 60_000) || !allow('run:all', 200, 24 * 60 * 60_000)) {
    return NextResponse.json({ error: 'The demo limits agent runs. Try again in a while, or run the project locally.' }, { status: 429 });
  }
  const { mandateId, goal } = (await req.json()) as { mandateId?: string; goal?: string };
  if (!mandateId || !getMandate(mandateId)) return NextResponse.json({ error: 'Unknown mandate' }, { status: 404 });
  if (!goal?.trim()) return NextResponse.json({ error: 'Tell the agent what to buy' }, { status: 400 });
  try {
    return NextResponse.json(await runAgent(mandateId, goal.trim().slice(0, 500)));
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 502 });
  }
}
