import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { config } from '@nexora/core/config';
import { endSession } from '@/lib/auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Sign out.
 *
 * The header renders this as a plain HTML form POST so it works without JavaScript. A browser
 * navigation therefore has to be redirected; returning JSON there would strand the person on a
 * raw `{"ok":true}` body that never signs them out visually. Fetch callers, which send an
 * explicit JSON accept header, still receive the payload.
 */
export async function POST(request: Request) {
  const store = await cookies();
  await endSession(store.get(config().sessionCookieName)?.value);
  store.delete(config().sessionCookieName);

  const accept = request.headers.get('accept') ?? '';
  if (accept.includes('text/html')) {
    return NextResponse.redirect(new URL('/login', request.url), 303);
  }
  return NextResponse.json({ ok: true, next: '/login' });
}