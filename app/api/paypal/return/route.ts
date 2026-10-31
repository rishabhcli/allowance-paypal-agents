import { NextResponse } from 'next/server';
import { completeBuyerApproval } from '@/lib/allowance/service';
import { hydrate, persist } from '@/lib/allowance/store';

// Where PayPal sends the buyer after they approve an order (wallet funding only).
export async function GET(req: Request) {
  const url = new URL(req.url);
  const id = url.searchParams.get('purchase');
  await hydrate();
  if (id) await completeBuyerApproval(id).catch(() => undefined);
  await persist();
  return NextResponse.redirect(new URL('/', url.origin));
}
