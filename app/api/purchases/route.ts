import { NextResponse } from 'next/server';
import { exclusive, hydrate, purchases } from '@/lib/allowance/store';

export const dynamic = 'force-dynamic';

export async function GET() {
  await exclusive(hydrate);
  return NextResponse.json(purchases());
}
