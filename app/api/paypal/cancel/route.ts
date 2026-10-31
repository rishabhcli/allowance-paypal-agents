import { NextResponse } from 'next/server';

export const GET = (req: Request) => NextResponse.redirect(new URL('/', new URL(req.url).origin));
