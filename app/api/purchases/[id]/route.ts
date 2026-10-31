import { NextResponse } from 'next/server';
import { hydrate, persist } from '@/lib/allowance/store';
import { capture, completeBuyerApproval, humanDecide, voidPurchase } from '@/lib/allowance/service';

// One endpoint for everything a person can do to a purchase: approve, reject, capture, void.
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const { action, finalCents } = (await req.json()) as { action?: string; finalCents?: number };
  try {
    await hydrate();
    switch (action) {
      case 'approve':
        return await done(await humanDecide(id, 'approve'));
      case 'reject':
        return await done(await humanDecide(id, 'reject'));
      case 'authorize':
        return await done(await completeBuyerApproval(id));
      case 'capture':
        return await done(await capture(id, finalCents));
      case 'void':
        return await done(await voidPurchase(id));
      default:
        return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
    }
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 409 });
  }
}

async function done(purchase: unknown) {
  await persist();
  return NextResponse.json(purchase);
}
