/**
 * Auth primitives that touch no database.
 *
 * These live apart from `auth-crypto.ts` so the SQL repositories and the in-memory double can
 * both use the exact same implementation. Previously the double imported them but did not
 * re-export them, so `@nexora/db` offered a smaller surface when the double was aliased in and
 * the application failed to compile with "Export hashSecurityAnswer doesn't exist in target
 * module". One implementation, two surfaces, no drift.
 */

import { createHash, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { config } from '@nexora/core/config';

const SCRYPT_KEYLEN = 64;
const SCRYPT_OPTS = { N: 16_384, r: 8, p: 1 } as const;

/** Case/whitespace-insensitive so a typo in casing does not lock anyone out. */
export function normalizeAnswer(answer: string): string {
  return answer.trim().toLowerCase().replace(/\s+/g, ' ');
}

/** Hash a security answer. Never stored in plaintext. */
export function hashSecurityAnswer(answer: string, salt?: string): { hash: string; salt: string } {
  const useSalt = salt ?? randomBytes(16).toString('hex');
  const derived = scryptSync(normalizeAnswer(answer), useSalt, SCRYPT_KEYLEN, SCRYPT_OPTS).toString('hex');
  return { hash: derived, salt: useSalt };
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

export interface AuthenticatedUser {
  id: string;
  full_name: string;
  username: string;
  created_at: Date;
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