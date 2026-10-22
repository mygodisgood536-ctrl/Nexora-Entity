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

/**
 * A session a person can see and revoke.
 *
 * The token itself is never exposed — only its hash-derived identifier and the metadata that
 * helps a person recognise a session ("Chrome on Windows, signed in today").
 */
export interface SessionSummary {
  id: string;
  createdAt: Date;
  expiresAt: Date;
  revokedAt: Date | null;
  ip: string | null;
  userAgent: string | null;
  current: boolean;
}

/** Every session belonging to a person, newest first. */
export async function listSessionsForUser(
  userId: string,
  currentTokenHash?: string,
): Promise<SessionSummary[]> {
  const rows = await query<{
    id: string;
    created_at: Date;
    expires_at: Date;
    revoked_at: Date | null;
    ip: string | null;
    user_agent: string | null;
    token_hash: string;
  }>(
    `SELECT id, created_at, expires_at, revoked_at, ip, user_agent, token_hash
       FROM auth_sessions
      WHERE user_id = $1
      ORDER BY created_at DESC`,
    [userId],
  );
  return rows.map((r) => ({
    id: r.id,
    createdAt: r.created_at,
    expiresAt: r.expires_at,
    revokedAt: r.revoked_at,
    ip: r.ip,
    userAgent: r.user_agent,
    current: currentTokenHash ? r.token_hash === currentTokenHash : false,
  }));
}

/** Revoke one session by its identifier. The person must own it. */
export async function revokeSessionById(sessionId: string, userId: string): Promise<boolean> {
  const rows = await query<{ id: string }>(
    'UPDATE auth_sessions SET revoked_at = now() WHERE id = $1 AND user_id = $2 AND revoked_at IS NULL RETURNING id',
    [sessionId, userId],
  );
  return rows.length > 0;
}

export async function revokeAllSessions(userId: string): Promise<void> {
  await query('UPDATE auth_sessions SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL', [
    userId,
  ]);
}