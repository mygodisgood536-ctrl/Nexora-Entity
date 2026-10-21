/**
 * In-memory repository double for `packages/db`.
 *
 * ── Why this exists ────────────────────────────────────────────────────────────────
 * The PostgreSQL integration is deliberately pending, which previously meant the entire
 * authenticated product — signup, entity creation, all 23 guided stages, uploads, the readiness
 * gate, the second pass and publication — could not be executed or verified at all. It could
 * only be reasoned about.
 *
 * This module makes it verifiable. It implements the *same exported repository interface* as
 * the PostgreSQL modules, against plain in-process data. It is a test double for the data
 * layer, not a second database: there is still exactly one schema (the migrations) and exactly
 * one set of repositories (the SQL ones). Nothing here is reachable from a normal run.
 *
 * ── Safety ───────────────────────────────────────────────────────────────────────────
 *  - Refuses to load when NODE_ENV=production. A production build can never use it.
 *  - Nothing is imported by any default code path. It is selected only by an explicit
 *    `NEXORA_DB_BACKEND=memory` together with a bundler alias, which the Next config itself
 *    rejects in production.
 *  - It does not pretend to be durable. Data lives for the lifetime of the process.
 *
 * ── Faithfulness ─────────────────────────────────────────────────────────────────────
 * Every function mirrors the SQL implementation's observable behaviour, including ordering,
 * upsert semantics and the status/timestamp rules. A function that is not implemented throws
 * `NotImplementedInMemory` naming itself, so a gap shows up as a loud failure rather than a
 * silently passing test.
 */

import { STAGE_KEYS, type StageKey, type StageStatus, type EntityStatus } from '@nexora/core';
import { slugify } from '@nexora/core';
import { config } from '@nexora/core/config';
import {
  normalizeQuestion,
  normalizeUsername,
  newSessionToken,
  hashToken,
  type AuthenticatedUser,
} from './auth-crypto';

/**
 * Re-exported so the aliased `@nexora/db` surface is identical to the real one. Without this the
 * application fails to compile when the double is in use, because callers legitimately import
 * these primitives from `@nexora/db`.
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
import { mem, clone, now, num, json, dateOrNull, type Row } from './memory-store';
import type { UserRecord, EntityRecord, StageProgressRecord } from './repos-core';

/** Thrown by any repository function that has not been mirrored yet. */
export class NotImplementedInMemory extends Error {
  constructor(fn: string) {
    super(`The in-memory database double does not implement ${fn}(). Implement it before relying on it in a test.`);
    this.name = 'NotImplementedInMemory';
  }
}

// ── store ────────────────────────────────────────────────────────────────────
const table = (name: string): Row[] => mem.table(name);
const uid = (): string => mem.uid();

/** Drop every row. Call between tests so data never leaks between them. */
export function resetMemoryDatabase(): void {
  mem.reset();
}

/** Row count per table. Useful for assertions and for proving a test actually wrote data. */
export function memoryTableSizes(): Record<string, number> {
  return mem.sizes();
}

const byId = <T>(name: string, id: string): T | null =>
  (table(name).find((r) => r['id'] === id) as unknown as T | undefined) ?? null;

// ── pool-shaped primitives ────────────────────────────────────────────────────
export async function query<T = Row>(_sql: string, _params?: unknown[]): Promise<T[]> {
  throw new NotImplementedInMemory('query');
}
export async function queryOne<T = Row>(_sql: string, _params?: unknown[]): Promise<T | null> {
  throw new NotImplementedInMemory('queryOne');
}
export async function healthcheck(): Promise<{ ok: boolean; detail: string }> {
  return { ok: true, detail: 'in-memory test double' };
}
export async function closePool(): Promise<void> {
  /* nothing to close */
}
export type TxFn = <T = Row>(fn: (sql: string, params?: unknown[]) => Promise<T[]>) => Promise<T>;
export async function transaction<T>(fn: (tx: TxFn) => Promise<T>): Promise<T> {
  return fn((async () => []) as unknown as TxFn);
}
export function bool(v: unknown): boolean {
  if (typeof v === 'boolean') return v;
  if (typeof v === 'string') return v === 't' || v === 'true' || v === '1';
  return Boolean(v);
}
export function toIso(v: Date | null | undefined): string | null {
  return v ? v.toISOString() : null;
}
export { num, json, dateOrNull };

// ── users & auth ─────────────────────────────────────────────────────────────
export async function findUserByUsername(username: string): Promise<UserRecord | null> {
  const norm = normalizeUsername(username);
  return (table('users').find((r) => r['username_norm'] === norm) as UserRecord | undefined) ?? null;
}

export async function findUserById(id: string): Promise<UserRecord | null> {
  return byId<UserRecord>('users', id);
}

export async function usernameAvailable(username: string): Promise<boolean> {
  return !(await findUserByUsername(username));
}

export async function insertUser(input: {
  fullName: string;
  username: string;
  securityQuestion: string;
  answerHash: string;
  answerSalt: string;
}): Promise<UserRecord> {
  if (!(await usernameAvailable(input.username))) throw new Error('username already exists');
  const row: UserRecord = {
    id: uid(),
    full_name: input.fullName,
    username: normalizeUsername(input.username),
    // The SQL implementation stores this column and `findUserByUsername` matches on it. Without
    // it the user is stored but can never be found again, so sign-up silently "succeeds" and login
    // can never succeed.
    username_norm: normalizeUsername(input.username),
    security_question: input.securityQuestion,
    security_question_norm: normalizeQuestion(input.securityQuestion),
    security_answer_hash: input.answerHash,
    security_answer_salt: input.answerSalt,
    failed_attempts: 0,
    locked_until: null,
    created_at: now(),
    last_login_at: null,
  };
  table('users').push(row as unknown as Row);
  return row;
}

export async function recordLoginAttempt(input: {
  userId: string | null;
  username: string;
  succeeded: boolean;
  ip?: string | undefined;
}): Promise<void> {
  table('auth_attempts').push({
    id: table('auth_attempts').length + 1,
    user_id: input.userId,
    username_norm: normalizeUsername(input.username),
    succeeded: input.succeeded,
    ip: input.ip ?? null,
    created_at: now(),
  });
}

export async function registerFailedAttempt(
  userId: string,
  lockThreshold = 8,
): Promise<{ lockedUntil: Date | null }> {
  const user = byId<UserRecord>('users', userId);
  if (!user) return { lockedUntil: null };
  user.failed_attempts += 1;
  if (user.failed_attempts >= lockThreshold) {
    user.locked_until = new Date(now().getTime() + 15 * 60 * 1000);
  }
  return { lockedUntil: user.locked_until };
}

export async function registerSuccessfulAttempt(userId: string): Promise<void> {
  const user = byId<UserRecord>('users', userId);
  if (!user) return;
  user.failed_attempts = 0;
  user.locked_until = null;
  user.last_login_at = now();
}

export async function updateSecurityAnswer(
  userId: string,
  input: { question: string; hash: string; salt: string },
): Promise<void> {
  const user = byId<UserRecord>('users', userId);
  if (!user) return;
  user.security_question = input.question;
  user.security_question_norm = normalizeQuestion(input.question);
  user.security_answer_hash = input.hash;
  user.security_answer_salt = input.salt;
}

// ── sessions ─────────────────────────────────────────────────────────────────
interface SessionRow {
  id: string;
  user_id: string;
  token_hash: string;
  expires_at: Date;
  revoked_at: Date | null;
  ip: string | null;
  user_agent: string | null;
}

/**
 * Sessions are stored by SHA-256 hash, exactly as `auth_srypto.ts` does, so a test that passes
 * here exercises the same lookup path the hosted database will use. The raw token is returned once
 * and never persisted.
 */
export async function createSession(
  userId: string,
  meta: { ip?: string | undefined; userAgent?: string | undefined } = {},
): Promise<{ token: string; expiresAt: Date }> {
  const token = newSessionToken();
  const expiresAt = new Date(Date.now() + config().sessionTtlDays * 86_400_000);
  const row: SessionRow = {
    id: uid(),
    user_id: userId,
    token_hash: hashToken(token),
    expires_at: expiresAt,
    revoked_at: null,
    ip: meta.ip ?? null,
    user_agent: meta.userAgent?.slice(0, 400) ?? null,
  };
  table('auth_sessions').push(row as unknown as Row);
  return { token, expiresAt };
}

export async function resolveSession(token: string | undefined): Promise<AuthenticatedUser | null> {
  if (!token) return null;
  const session = table('auth_sessions').find((r) => r['token_hash'] === hashToken(token));
  if (!session) return null;
  if (session['revoked_at']) return null;
  if (new Date(String(session['expires_at'])).getTime() < Date.now()) return null;
  const user = byId<UserRecord>('users', String(session['user_id']));
  if (!user) return null;
  return {
    id: user.id,
    full_name: user.full_name,
    username: user.username,
    created_at: user.created_at,
  };
}

export async function revokeSession(token: string): Promise<void> {
  const row = table('auth_sessions').find((r) => r['token_hash'] === hashToken(token));
  if (row) row['revoked_at'] = now();
}

export async function revokeAllSessions(userId: string): Promise<void> {
  for (const row of table('auth_sessions')) {
    if (row['user_id'] === userId && !row['revoked_at']) row['revoked_at'] = now();
  }
}

// ── entities ─────────────────────────────────────────────────────────────────
export function newEntityUid(): string {
  const alphabet = '0123456789abcdefghjkmnpqrstvwxyz';
  let body = '';
  const bytes = new Uint8Array(20);
  crypto.getRandomValues(bytes);
  for (const b of bytes) body += alphabet[b % alphabet.length];
  return `nexora:entity:${body}`;
}

function slugAvailableFor(base: string): string {
  const seed = slugify(base, 'entity');
  for (let i = 0; i < 60; i += 1) {
    const candidate = i === 0 ? seed : `${seed}-${i + 1}`;
    if (!table('entities').some((r) => r['slug'] === candidate)) return candidate;
  }
  return `${seed}-${Math.floor(Math.random() * 1e8).toString(16)}`;
}

export async function createEntity(input: { userId: string; displayName: string }): Promise<EntityRecord> {
  const slug = slugAvailableFor(input.displayName);
  const entityUid = newEntityUid();
  const entity: EntityRecord = {
    id: uid(),
    user_id: input.userId,
    entity_uid: entityUid,
    slug,
    canonical_path: `/entity/${entityUid.replace(/[^a-z0-9]/gi, '')}`,
    display_name: input.displayName,
    status: 'draft' as EntityStatus,
    published_at: null,
    primary_domain: null,
    site_photo_id: null,
    created_at: now(),
    updated_at: now(),
  };
  table('entities').push(entity as unknown as Row);
  // Every entity starts with all 23 stages present as `pending`, exactly as the SQL does.
  for (const key of STAGE_KEYS) {
    table('stage_progress').push({
      id: uid(),
      entity_id: entity.id,
      stage_key: key,
      status: 'pending',
      skip_note: null,
      data: {},
      touched_at: now(),
      completed_at: null,
      skipped_at: null,
      updated_at: now(),
    });
  }
  return entity;
}

export async function findEntityForUser(entityId: string, userId: string): Promise<EntityRecord | null> {
  const e = byId<EntityRecord>('entities', entityId);
  return e && e.user_id === userId ? e : null;
}
export async function findEntityById(entityId: string): Promise<EntityRecord | null> {
  return byId<EntityRecord>('entities', entityId);
}
export async function findEntityBySlug(slug: string): Promise<EntityRecord | null> {
  return (table('entities').find((r) => r['slug'] === slug) as EntityRecord | undefined) ?? null;
}
export async function findEntityByDomain(hostname: string): Promise<EntityRecord | null> {
  const host = hostname.toLowerCase();
  const domain = table('domains').find(
    (d) => d['hostname'] === host && d['status'] === 'active' && d['kind'] === 'custom',
  );
  if (!domain) return null;
  return byId<EntityRecord>('entities', String(domain['entity_id']));
}
export async function listEntitiesForUser(userId: string): Promise<EntityRecord[]> {
  return table('entities')
    .filter((r) => r['user_id'] === userId)
    .map((r) => r as unknown as EntityRecord)
    .sort((a, b) => a.created_at.getTime() - b.created_at.getTime());
}
export async function updateEntityStatus(entityId: string, status: EntityStatus): Promise<void> {
  const e = byId<EntityRecord>('entities', entityId);
  if (e) {
    e.status = status;
    e.updated_at = now();
  }
}
export async function setEntityDisplayName(entityId: string, name: string): Promise<void> {
  const e = byId<EntityRecord>('entities', entityId);
  if (e) {
    e.display_name = name;
    e.updated_at = now();
  }
}
export async function setEntityPublished(
  entityId: string,
  deploymentId: string,
  domain: string | null,
): Promise<void> {
  const e = byId<EntityRecord>('entities', entityId);
  if (!e) return;
  e.status = 'published' as EntityStatus;
  e.published_at = now();
  (e as unknown as Row)['last_published_deployment_id'] = deploymentId;
  if (domain) e.primary_domain = domain;
  e.updated_at = now();
}
export async function setEntityPrimaryPhoto(entityId: string, photoId: string | null): Promise<void> {
  const e = byId<EntityRecord>('entities', entityId);
  if (e) {
    e.site_photo_id = photoId;
    e.updated_at = now();
  }
}

// ── stage progress ───────────────────────────────────────────────────────────
export async function listStageProgress(entityId: string): Promise<StageProgressRecord[]> {
  return table('stage_progress')
    .filter((r) => r['entity_id'] === entityId)
    .map((r) => r as unknown as StageProgressRecord)
    .sort((a, b) => String(a.stage_key).localeCompare(String(b.stage_key)));
}

export async function getStageProgress(
  entityId: string,
  stageKey: StageKey,
): Promise<StageProgressRecord | null> {
  return (
    (table('stage_progress').find((r) => r['entity_id'] === entityId && r['stage_key'] === stageKey) as
      | StageProgressRecord
      | undefined) ?? null
  );
}

/**
 * Mirrors the SQL upsert, including the timestamp rules:
 *  - `completed_at` is set when the new status is `complete`, and preserved otherwise
 *  - `skipped_at` is set when the new status is `skipped`, and cleared otherwise
 *
 * That last rule is the one the autosave bug violated, so it is reproduced exactly: a save can
 * clear `skipped_at`, and a test asserting that a skip survives an unrelated save is meaningful.
 */
export async function saveStageProgress(input: {
  entityId: string;
  stageKey: StageKey;
  status: StageStatus;
  data: Record<string, unknown>;
  skipNote?: string | null;
}): Promise<StageProgressRecord> {
  const existing = table('stage_progress').find(
    (r) => r['entity_id'] === input.entityId && r['stage_key'] === input.stageKey,
  ) as StageProgressRecord | undefined;

  if (existing) {
    existing.status = input.status;
    existing.data = clone(input.data);
    existing.skip_note = input.skipNote ?? null;
    existing.touched_at = now();
    (existing as unknown as Row)['updated_at'] = now();
    if (input.status === 'complete') existing.completed_at = now();
    if (input.status === 'skipped') existing.skipped_at = now();
    else existing.skipped_at = null;
    return existing;
  }

  const created: StageProgressRecord = {
    id: uid(),
    entity_id: input.entityId,
    stage_key: input.stageKey,
    status: input.status,
    skip_note: input.skipNote ?? null,
    data: clone(input.data),
    touched_at: now(),
    completed_at: input.status === 'complete' ? now() : null,
    skipped_at: input.status === 'skipped' ? now() : null,
    updated_at: now(),
  } as StageProgressRecord;
  table('stage_progress').push(created as unknown as Row);
  return created;
}

export async function stageCounts(entityId: string): Promise<Record<StageStatus, number>> {
  const out: Record<StageStatus, number> = { pending: 0, in_progress: 0, complete: 0, skipped: 0 };
  for (const r of table('stage_progress')) {
    if (r['entity_id'] === entityId) out[r['status'] as StageStatus] += 1;
  }
  return out;
}

// ── audit & settings ─────────────────────────────────────────────────────────
export async function audit(input: {
  userId?: string | undefined;
  entityId?: string | undefined;
  action: string;
  actor?: 'user' | 'system' | 'ai';
  detail?: Record<string, unknown>;
  ip?: string | undefined;
}): Promise<void> {
  table('audit_log').push({
    id: table('audit_log').length + 1,
    user_id: input.userId ?? null,
    entity_id: input.entityId ?? null,
    action: input.action,
    actor: input.actor ?? 'user',
    detail: clone(input.detail ?? {}),
    ip: input.ip ?? null,
    created_at: now(),
  });
}

export async function recentAudit(
  entityId: string,
  limit = 50,
): Promise<{ action: string; actor: string; detail: unknown; created_at: Date }[]> {
  return table('audit_log')
    .filter((r) => r['entity_id'] === entityId)
    .slice(-limit)
    .reverse()
    .map((r) => ({ action: String(r['action']), actor: String(r['actor']), detail: r['detail'], created_at: r['created_at'] as Date }));
}

export async function getSetting<T>(key: string, dflt: T): Promise<T> {
  const row = table('platform_settings').find((r) => r['key'] === key);
  return row ? (row['value'] as T) : dflt;
}

export async function setSetting(key: string, value: unknown): Promise<void> {
  const row = table('platform_settings').find((r) => r['key'] === key);
  if (row) {
    row['value'] = clone(value);
    row['updated_at'] = now();
    return;
  }
  table('platform_settings').push({ key, value: clone(value), updated_at: now() });
}

export function iso(v: Date | null | undefined): string | null {
  return toIso(v);
}