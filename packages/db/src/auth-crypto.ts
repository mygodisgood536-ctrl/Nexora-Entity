/** Auth: password hashing, session tokens, cookie helpers. */

import { config } from '@nexora/core/config';
import { query, queryOne } from './pool';
import { hashToken, newSessionToken, type AuthenticatedUser } from './auth-crypto-core';

/**
 * The pure primitives live in `auth-crypto-core.ts` so the in-memory double can expose an
 * identical surface. Re-exported here because `@nexora/db` presents them as one module.
 */
export {
  hashSecurityAnswer,
  normalizeAnswer,
  verifySecurityAnswer,
  normalizeUsername,
  normalizeQuestion,
  hashToken,
  newSessionToken,
  sessionCookie,
  clearSessionCookie,
} from './auth-crypto-core';
export type { SessionRow, AuthenticatedUser } from './auth-crypto-core';

export async function createSession(
  userId: string,
  meta: { ip?: string | undefined; userAgent?: string | undefined } = {},
): Promise<{ token: string; expiresAt: Date }> {
  const token = newSessionToken();
  const ttl = config().sessionTtlDays;
  const expiresAt = new Date(Date.now() + ttl * 86_400_000);
  await query(
    `INSERT INTO auth_sessions (user_id, token_hash, expires_at, ip, user_agent)
     VALUES ($1, $2, $3, $4, $5)`,
    [userId, hashToken(token), expiresAt, meta.ip ?? null, meta.userAgent?.slice(0, 400) ?? null],
  );
  return { token, expiresAt };
}

export async function resolveSession(token: string | undefined): Promise<AuthenticatedUser | null> {
  if (!token) return null;
  const row = await queryOne<{
    user_id: string;
    full_name: string;
    username: string;
    created_at: Date;
    expires_at: Date;
    revoked_at: Date | null;
  }>(
    `SELECT s.user_id, s.expires_at, s.revoked_at, u.full_name, u.username, u.created_at
       FROM auth_sessions s
       JOIN users u ON u.id = s.user_id
      WHERE s.token_hash = $1`,
    [hashToken(token)],
  );
  if (!row) return null;
  if (row.revoked_at) return null;
  if (new Date(row.expires_at).getTime() < Date.now()) return null;
  return {
    id: row.user_id,
    full_name: row.full_name,
    username: row.username,
    created_at: row.created_at,
  };
}

export async function revokeSession(token: string): Promise<void> {
  await query('UPDATE auth_sessions SET revoked_at = now() WHERE token_hash = $1', [hashToken(token)]);
}

export async function revokeAllSessions(userId: string): Promise<void> {
  await query('UPDATE auth_sessions SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL', [
    userId,
  ]);
}