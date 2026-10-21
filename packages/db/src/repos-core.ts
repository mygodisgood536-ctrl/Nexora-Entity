/** User + entity + stage-progress repositories. */

import { normalizeQuestion, normalizeUsername } from './auth-crypto';
import { bool, query, queryOne, toIso, transaction, type TxFn } from './pool';
import { slugify } from '@nexora/core';
import { STAGE_KEYS, type StageKey, type StageStatus, type EntityStatus } from '@nexora/core';

export interface UserRecord {
  id: string;
  full_name: string;
  username: string;
  username_norm: string;
  security_question: string;
  security_question_norm: string;
  security_answer_hash: string;
  security_answer_salt: string;
  failed_attempts: number;
  locked_until: Date | null;
  created_at: Date;
  last_login_at: Date | null;
}

export async function findUserByUsername(username: string): Promise<UserRecord | null> {
  return queryOne<UserRecord>('SELECT * FROM users WHERE username_norm = $1', [
    normalizeUsername(username),
  ]);
}

export async function findUserById(id: string): Promise<UserRecord | null> {
  return queryOne<UserRecord>('SELECT * FROM users WHERE id = $1', [id]);
}

export async function usernameAvailable(username: string): Promise<boolean> {
  const row = await queryOne<{ exists: boolean }>(
    'SELECT EXISTS (SELECT 1 FROM users WHERE username_norm = $1) AS exists',
    [normalizeUsername(username)],
  );
  return !(row?.exists ?? false);
}

export async function insertUser(input: {
  fullName: string;
  username: string;
  securityQuestion: string;
  answerHash: string;
  answerSalt: string;
}): Promise<UserRecord> {
  const rows = await query<UserRecord>(
    `INSERT INTO users (full_name, username, username_norm, security_question,
                        security_question_norm, security_answer_hash, security_answer_salt)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING *`,
    [
      input.fullName,
      normalizeUsername(input.username),
      normalizeUsername(input.username),
      input.securityQuestion,
      normalizeQuestion(input.securityQuestion),
      input.answerHash,
      input.answerSalt,
    ],
  );
  const row = rows[0];
  if (!row) throw new Error('insertUser returned no row');
  return row;
}

export async function recordLoginAttempt(input: {
  userId: string | null;
  username: string;
  succeeded: boolean;
  ip?: string | undefined;
}): Promise<void> {
  await query(
    'INSERT INTO auth_attempts (user_id, username_norm, succeeded, ip) VALUES ($1, $2, $3, $4)',
    [input.userId, normalizeUsername(input.username), input.succeeded, input.ip ?? null],
  );
}

export async function registerFailedAttempt(userId: string, lockThreshold = 8): Promise<{ lockedUntil: Date | null }> {
  const row = await queryOne<{ failed_attempts: number; locked_until: Date | null }>(
    'UPDATE users SET failed_attempts = failed_attempts + 1, locked_until = CASE WHEN failed_attempts + 1 >= $2 THEN now() + interval \'15 minutes\' ELSE locked_until END WHERE id = $1 RETURNING failed_attempts, locked_until',
    [userId, lockThreshold],
  );
  return { lockedUntil: row?.locked_until ?? null };
}

export async function registerSuccessfulAttempt(userId: string): Promise<void> {
  await query(
    'UPDATE users SET failed_attempts = 0, locked_until = NULL, last_login_at = now() WHERE id = $1',
    [userId],
  );
}

export async function updateSecurityAnswer(
  userId: string,
  input: { question: string; hash: string; salt: string },
): Promise<void> {
  await query(
    `UPDATE users
        SET security_question = $2, security_question_norm = $3,
            security_answer_hash = $4, security_answer_salt = $5, updated_at = now()
      WHERE id = $1`,
    [userId, input.question, normalizeQuestion(input.question), input.hash, input.salt],
  );
}

// ── Entities ─────────────────────────────────────────────────────────────

export interface EntityRecord {
  id: string;
  user_id: string;
  entity_uid: string;
  slug: string;
  canonical_path: string;
  display_name: string | null;
  status: EntityStatus;
  published_at: Date | null;
  primary_domain: string | null;
  site_photo_id: string | null;
  created_at: Date;
  updated_at: Date;
}

/** Stable internal entity identifier. Deliberately independent of slug, domain and username. */
export function newEntityUid(): string {
  const alphabet = '0123456789abcdefghjkmnpqrstvwxyz';
  let body = '';
  const bytes = crypto.getRandomValues(new Uint8Array(20));
  for (const b of bytes) body += alphabet[b % alphabet.length];
  return `nexora:entity:${body}`;
}

async function slugAvailable(tx: TxFn, base: string): Promise<string> {
  const seed = slugify(base, 'entity');
  for (let i = 0; i < 60; i += 1) {
    const candidate = i === 0 ? seed : `${seed}-${i + 1}`;
    const rows = await tx<{ exists: boolean }>(
      'SELECT EXISTS (SELECT 1 FROM entities WHERE slug = $1) AS exists',
      [candidate],
    );
    if (!rows[0]?.exists) return candidate;
  }
  return `${seed}-${crypto.randomUUID().slice(0, 8)}`;
}

export async function createEntity(input: {
  userId: string;
  displayName: string;
}): Promise<EntityRecord> {
  return transaction(async (tx) => {
    const slug = await slugAvailable(tx, input.displayName);
    const uid = newEntityUid();
    const canonicalPath = `/entity/${uid.replace(/[^a-z0-9]/gi, '')}`;
    const rows = await tx<EntityRecord>(
      `INSERT INTO entities (user_id, entity_uid, slug, canonical_path, display_name, status)
       VALUES ($1, $2, $3, $4, $5, 'draft')
       RETURNING *`,
      [input.userId, uid, slug, canonicalPath, input.displayName],
    );
    const entity = rows[0];
    if (!entity) throw new Error('createEntity returned no row');

    const progress: StageKey[] = [];
    for (const key of STAGE_KEYS) {
      await tx(
        `INSERT INTO stage_progress (entity_id, stage_key, status)
         VALUES ($1, $2, 'pending') ON CONFLICT DO NOTHING`,
        [entity.id, key],
      );
      progress.push(key);
    }
    void progress;
    return entity;
  });
}

export async function findEntityForUser(entityId: string, userId: string): Promise<EntityRecord | null> {
  return queryOne<EntityRecord>('SELECT * FROM entities WHERE id = $1 AND user_id = $2', [
    entityId,
    userId,
  ]);
}

export async function findEntityById(entityId: string): Promise<EntityRecord | null> {
  return queryOne<EntityRecord>('SELECT * FROM entities WHERE id = $1', [entityId]);
}

export async function findEntityBySlug(slug: string): Promise<EntityRecord | null> {
  return queryOne<EntityRecord>('SELECT * FROM entities WHERE slug = $1', [slug]);
}

export async function findEntityByDomain(hostname: string): Promise<EntityRecord | null> {
  const rows = await query<EntityRecord>(
    `SELECT e.* FROM entities e
       JOIN domains d ON d.entity_id = e.id
      WHERE d.hostname = $1 AND d.status = 'active' AND d.kind = 'custom'
      LIMIT 1`,
    [hostname.toLowerCase()],
  );
  return rows[0] ?? null;
}

export async function listEntitiesForUser(userId: string): Promise<EntityRecord[]> {
  return query<EntityRecord>('SELECT * FROM entities WHERE user_id = $1 ORDER BY created_at ASC', [userId]);
}

export async function updateEntityStatus(entityId: string, status: EntityStatus): Promise<void> {
  await query('UPDATE entities SET status = $2, updated_at = now() WHERE id = $1', [entityId, status]);
}

export async function setEntityDisplayName(entityId: string, name: string): Promise<void> {
  await query('UPDATE entities SET display_name = $2, updated_at = now() WHERE id = $1', [entityId, name]);
}

export async function setEntityPublished(
  entityId: string,
  deploymentId: string,
  domain: string | null,
): Promise<void> {
  await query(
    `UPDATE entities
        SET status = 'published', published_at = now(), last_published_deployment_id = $2,
            primary_domain = COALESCE($3, primary_domain), updated_at = now()
      WHERE id = $1`,
    [entityId, deploymentId, domain],
  );
}

export async function setEntityPrimaryPhoto(entityId: string, photoId: string | null): Promise<void> {
  await query('UPDATE entities SET site_photo_id = $2, updated_at = now() WHERE id = $1', [
    entityId,
    photoId,
  ]);
}

// ── Stage progress ───────────────────────────────────────────────────────

export interface StageProgressRecord {
  id: string;
  entity_id: string;
  stage_key: StageKey;
  status: StageStatus;
  skip_note: string | null;
  data: Record<string, unknown>;
  touched_at: Date;
  completed_at: Date | null;
  skipped_at: Date | null;
}

export async function listStageProgress(entityId: string): Promise<StageProgressRecord[]> {
  return query<StageProgressRecord>(
    'SELECT * FROM stage_progress WHERE entity_id = $1 ORDER BY stage_key ASC',
    [entityId],
  );
}

export async function getStageProgress(
  entityId: string,
  stageKey: StageKey,
): Promise<StageProgressRecord | null> {
  return queryOne<StageProgressRecord>(
    'SELECT * FROM stage_progress WHERE entity_id = $1 AND stage_key = $2',
    [entityId, stageKey],
  );
}

/**
 * Save stage data. Status is derived from the data, never guessed:
 *  - explicit skip           -> skipped
 *  - every field blank        -> pending (a skip is not a satisfaction)
 *  - all required fields set  -> complete
 *  - otherwise                -> in_progress
 */
export async function saveStageProgress(input: {
  entityId: string;
  stageKey: StageKey;
  status: StageStatus;
  data: Record<string, unknown>;
  skipNote?: string | null;
}): Promise<StageProgressRecord> {
  const row = await queryOne<StageProgressRecord>(
    `INSERT INTO stage_progress (entity_id, stage_key, status, data, skip_note,
                                touched_at, completed_at, skipped_at, updated_at)
     VALUES ($1, $2, $3, $4::jsonb, $5, now(),
             CASE WHEN $3 = 'complete' THEN now() ELSE NULL END,
             CASE WHEN $3 = 'skipped' THEN now() ELSE NULL END,
             now())
     ON CONFLICT (entity_id, stage_key) DO UPDATE
       SET status = EXCLUDED.status, data = EXCLUDED.data, skip_note = EXCLUDED.skip_note,
           touched_at = now(), updated_at = now(),
           completed_at = CASE WHEN EXCLUDED.status = 'complete' THEN now() ELSE stage_progress.completed_at END,
           skipped_at  = CASE WHEN EXCLUDED.status = 'skipped'  THEN now() ELSE NULL END
     RETURNING *`,
    [input.entityId, input.stageKey, input.status, JSON.stringify(input.data), input.skipNote ?? null],
  );
  if (!row) throw new Error('saveStageProgress returned no row');
  return row;
}

export async function stageCounts(
  entityId: string,
): Promise<Record<StageStatus, number>> {
  const rows = await query<{ status: StageStatus; n: number }>(
    'SELECT status, count(*)::int AS n FROM stage_progress WHERE entity_id = $1 GROUP BY status',
    [entityId],
  );
  const out: Record<StageStatus, number> = { pending: 0, in_progress: 0, complete: 0, skipped: 0 };
  for (const r of rows) out[r.status] = r.n;
  return out;
}

// ── Audit ────────────────────────────────────────────────────────────────

export async function audit(input: {
  userId?: string | undefined;
  entityId?: string | undefined;
  action: string;
  actor?: 'user' | 'system' | 'ai';
  detail?: Record<string, unknown>;
  ip?: string | undefined;
}): Promise<void> {
  await query(
    `INSERT INTO audit_log (user_id, entity_id, action, actor, detail, ip)
     VALUES ($1, $2, $3, $4, $5::jsonb, $6)`,
    [
      input.userId ?? null,
      input.entityId ?? null,
      input.action,
      input.actor ?? 'user',
      JSON.stringify(input.detail ?? {}),
      input.ip ?? null,
    ],
  );
}

export async function recentAudit(entityId: string, limit = 50): Promise<
  { action: string; actor: string; detail: unknown; created_at: Date }[]
> {
  return query('SELECT action, actor, detail, created_at FROM audit_log WHERE entity_id = $1 ORDER BY id DESC LIMIT $2', [
    entityId,
    limit,
  ]);
}

export async function getSetting<T>(key: string, dflt: T): Promise<T> {
  const row = await queryOne<{ value: T }>('SELECT value FROM platform_settings WHERE key = $1', [key]);
  return row?.value ?? dflt;
}

export async function setSetting(key: string, value: unknown): Promise<void> {
  await query(
    `INSERT INTO platform_settings (key, value, updated_at) VALUES ($1, $2::jsonb, now())
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
    [key, JSON.stringify(value ?? null)],
  );
}

export function iso(v: Date | null | undefined): string | null {
  return toIso(v);
}

export { bool };