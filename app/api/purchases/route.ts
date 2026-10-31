import { NextResponse } from 'next/server';
import { purchases } from '@/lib/allowance/store';

export const dynamic = 'force-dynamic';

export const GET = () => NextResponse.json(purchases());
