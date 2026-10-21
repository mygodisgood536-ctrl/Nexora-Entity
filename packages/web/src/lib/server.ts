/**
 * Nexora Entity platform — server runtime helpers shared by every route handler.
 */

import { cookies, headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { config } from '@nexora/core/config';
import { AuthError, toActionableError, type ActionableErrorShape } from '@nexora/core';
import { resolveSession, type AuthenticatedUser } from '@nexora/db';

export async function currentUser(): Promise<AuthenticatedUser | null> {
  const store = await cookies();
  return resolveSession(store.get(config().sessionCookieName)?.value);
}

export async function requireUser(returnTo?: string): Promise<AuthenticatedUser> {
  const user = await currentUser();
  if (!user) {
    redirect(returnTo ? `/login?next=${encodeURIComponent(returnTo)}` : '/login');
  }
  return user;
}

export async function requestMetaAsync(): Promise<{ ip: string | undefined; userAgent: string | undefined }> {
  const h = await headers();
  const forwarded = h.get('x-forwarded-for');
  return {
    ip: forwarded?.split(',')[0]?.trim() ?? h.get('x-real-ip') ?? undefined,
    userAgent: h.get('user-agent') ?? undefined,
  };
}

export function isSecureRequest(): boolean {
  const url = config().platformOrigin;
  return url.startsWith('https://');
}

/** Wrap a route handler so failures become actionable, serialisable errors. */
export async function handle<T>(fn: () => Promise<T>): Promise<{ ok: true; data: T } | { ok: false; error: ActionableErrorShape }> {
  try {
    return { ok: true, data: await fn() };
  } catch (err) {
    return { ok: false, error: toActionableError(err) };
  }
}

export { AuthError, config };