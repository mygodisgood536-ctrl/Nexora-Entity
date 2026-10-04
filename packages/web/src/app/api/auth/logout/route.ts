import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { config } from '@nexora/core/config';
import { endSession } from '@/lib/auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST() {
  const store = await cookies();
  await endSession(store.get(config().sessionCookieName)?.value);
  store.delete(config().sessionCookieName);
  return NextResponse.json({ ok: true, next: '/login' });
}