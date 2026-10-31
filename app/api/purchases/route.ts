import { NextResponse } from 'next/server';
import { hydrate, purchases } from '@/lib/allowance/store';

export const dynamic = 'force-dynamic';

export async function GET() {
  await hydrate();
  return NextResponse.json(purchases());
}
