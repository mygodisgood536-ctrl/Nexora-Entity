/** Auth: password hashing, session tokens, cookie helpers. */

import { createHash, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { config } from '@nexora/core/config';
import { query, queryOne } from './pool';

const SCRYPT_KEYLEN = 64;
const SCRYPT_OPTS = { N: 16_384, r: 8, p: 1 } as const;

/** Hash a security answer. Never stored in plaintext. */
export function hashSecurityAnswer(answer: string, salt?: string): { hash: string; salt: string } {
  const useSalt = salt ?? randomBytes(16).toString('hex');
  const derived = scryptSync(normalizeAnswer(answer), useSalt, SCRYPT_KEYLEN, SCRYPT_OPTS).toString('hex');
  return { hash: derived, salt: useSalt };
}

/** Case/whitespace-insensitive so a typo in casing does not lock anyone out. */
export function normalizeAnswer(answer: string): string {
  return answer.trim().toLowerCase().replace(/\s+/g, ' ');
}

export function verifySecurityAnswer(answer: string, hash: string, salt: string): boolean {
  const { hash: candidate } = hashSecurityAnswer(answer, salt);
  const a = Buffer.from(candidate, 'hex');
  const b = Buffer.from(hash, 'hex');
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export function normalizeUsername(username: string): string {
  return username.trim().toLowerCase();
}

export function normalizeQuestion(question: string): string {
  return question.trim().toLowerCase().replace(/\s+/g, ' ');
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export function newSessionToken(): string {
  return randomBytes(32).toString('base64url');
}

export interface SessionRow {
  id: string;
  user_id: string;
  expires_at: Date;
  revoked_at: Date | null;
}

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

export interface AuthenticatedUser {
  id: string;
  full_name: string;
  username: string;
  created_at: Date;
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

export function sessionCookie(token: string, expiresAt: Date, secure: boolean): string {
  const parts = [
    `${config().sessionCookieName}=${token}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Expires=${expiresAt.toUTCString()}`,
  ];
  if (secure) parts.push('Secure');
  return parts.join('; ');
}

export function clearSessionCookie(secure: boolean): string {
  const parts = [
    `${config().sessionCookieName}=`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    'Max-Age=0',
  ];
  if (secure) parts.push('Secure');
  return parts.join('; ');
}