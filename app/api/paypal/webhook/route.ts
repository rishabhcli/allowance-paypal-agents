import { NextResponse } from 'next/server';
import { hydrate, persist } from '@/lib/allowance/store';
import { applyEvent, verifySignature, type WebhookEvent } from '@/lib/allowance/webhook';

export async function POST(req: Request) {
  const event = (await req.json()) as WebhookEvent;
  if (!(await verifySignature(req.headers, event))) return NextResponse.json({ error: 'signature not verified' }, { status: 401 });
  await hydrate();
  const applied = applyEvent(event) ?? null;
  await persist();
  return NextResponse.json({ ok: true, applied });
}
