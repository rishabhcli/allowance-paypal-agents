import { NextResponse } from 'next/server';
import { completeBuyerApproval } from '@/lib/allowance/service';

// Where PayPal sends the buyer after they approve an order (wallet funding only).
export async function GET(req: Request) {
  const url = new URL(req.url);
  const id = url.searchParams.get('purchase');
  if (id) await completeBuyerApproval(id).catch(() => undefined);
  return NextResponse.redirect(new URL('/', url.origin));
}
