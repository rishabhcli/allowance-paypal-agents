import { NextResponse } from 'next/server';
import { hydrate, mandates, persist, updateMandate } from '@/lib/allowance/store';

export const dynamic = 'force-dynamic';

export async function GET() {
  await hydrate();
  return NextResponse.json(mandates());
}

const NUMERIC = ['perPurchaseCapCents', 'autoApproveUpToCents', 'dailyBudgetCents', 'monthlyBudgetCents', 'maxAutoApprovalsPerHour'] as const;

export async function PATCH(req: Request) {
  await hydrate();
  const { id, ...patch } = (await req.json()) as Record<string, unknown> & { id?: string };
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 });
  const clean: Record<string, unknown> = {};
  if (typeof patch.paused === 'boolean') clean.paused = patch.paused;
  for (const k of NUMERIC) if (typeof patch[k] === 'number' && Number.isInteger(patch[k]) && (patch[k] as number) >= 0) clean[k] = patch[k];
  for (const k of ['allowedMerchants', 'blockedMerchants', 'allowedCategories'] as const) {
    if (Array.isArray(patch[k])) clean[k] = (patch[k] as unknown[]).filter((v): v is string => typeof v === 'string');
  }
  const updated = updateMandate(id, clean);
  await persist();
  return updated ? NextResponse.json(updated) : NextResponse.json({ error: 'Unknown mandate' }, { status: 404 });
}
