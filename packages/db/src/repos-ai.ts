/**
 * AI configuration + OpenCode snapshot repositories.
 *
 * The provider/model catalogue is NEVER stored as a hard-coded list. What is stored is a
 * snapshot of what OpenCode reported, refreshed on demand, plus the account-level active
 * selection the user verified.
 */

import { query, queryOne } from './pool';

export interface AiConfigurationRecord {
  id: string;
  user_id: string;
  provider_id: string;
  provider_name: string;
  model_id: string;
  model_name: string;
  is_active: boolean;
  status: 'verified' | 'degraded' | 'failed' | 'replaced';
  verified_at: Date | null;
  verification: Record<string, unknown>;
  last_used_at: Date | null;
  last_error: string | null;
  last_error_code: string | null;
  last_error_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

export async function getActiveAiConfiguration(userId: string): Promise<AiConfigurationRecord | null> {
  return queryOne<AiConfigurationRecord>(
    'SELECT * FROM ai_configurations WHERE user_id = $1 AND is_active LIMIT 1',
    [userId],
  );
}

export async function listAiConfigurations(userId: string): Promise<AiConfigurationRecord[]> {
  return query<AiConfigurationRecord>(
    'SELECT * FROM ai_configurations WHERE user_id = $1 ORDER BY created_at DESC LIMIT 50',
    [userId],
  );
}

export async function upsertVerifiedAiConfiguration(input: {
  userId: string;
  providerId: string;
  providerName: string;
  modelId: string;
  modelName: string;
  verification: Record<string, unknown>;
}): Promise<AiConfigurationRecord> {
  const previous = await getActiveAiConfiguration(input.userId);
  const row = await queryOne<AiConfigurationRecord>(
    `WITH deactivated AS (
       UPDATE ai_configurations SET is_active = false, updated_at = now()
        WHERE user_id = $1 AND is_active
        RETURNING id
     )
     INSERT INTO ai_configurations (user_id, provider_id, provider_name, model_id, model_name,
                                    is_active, status, verified_at, verification)
     VALUES ($1, $2, $3, $4, $5, true, 'verified', now(), $6::jsonb)
     RETURNING *,
       (SELECT id FROM deactivated) AS replaced_config_id`,
    [
      input.userId,
      input.providerId,
      input.providerName,
      input.modelId,
      input.modelName,
      JSON.stringify(input.verification),
    ],
  );
  if (!row) throw new Error('upsertVerifiedAiConfiguration returned no row');
  if (previous) {
    await query(`UPDATE ai_configurations SET status = 'replaced', updated_at = now() WHERE id = $1`, [
      previous.id,
    ]);
  }
  return row;
}

export async function markAiConfigurationFailed(
  userId: string,
  input: { error: string; code: string },
): Promise<void> {
  await query(
    `UPDATE ai_configurations
        SET status = 'failed', last_error = $2, last_error_code = $3, last_error_at = now(),
            updated_at = now()
      WHERE user_id = $1 AND is_active`,
    [userId, input.error, input.code],
  );
}

export async function touchAiConfiguration(configId: string): Promise<void> {
  await query('UPDATE ai_configurations SET last_used_at = now() WHERE id = $1', [configId]);
}

export async function logAiAttempt(input: {
  userId: string;
  configId?: string | null;
  providerId: string;
  modelId: string;
  operation: string;
  outcome: 'success' | 'failure';
  failureKind?: string | null;
  message?: string | null;
  detail?: Record<string, unknown>;
  latencyMs?: number | null;
}): Promise<void> {
  await query(
    `INSERT INTO ai_provider_attempts
       (user_id, config_id, provider_id, model_id, operation, outcome, failure_kind,
        message, detail, latency_ms)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10)`,
    [
      input.userId,
      input.configId ?? null,
      input.providerId,
      input.modelId,
      input.operation,
      input.outcome,
      input.failureKind ?? null,
      input.message ?? null,
      JSON.stringify(input.detail ?? {}),
      input.latencyMs ?? null,
    ],
  );
}

export async function recentAiAttempts(userId: string, limit = 25): Promise<
  {
    provider_id: string;
    model_id: string;
    operation: string;
    outcome: string;
    failure_kind: string | null;
    message: string | null;
    created_at: Date;
  }[]
> {
  return query(
    `SELECT provider_id, model_id, operation, outcome, failure_kind, message, created_at
       FROM ai_provider_attempts WHERE user_id = $1 ORDER BY id DESC LIMIT $2`,
    [userId, limit],
  );
}

// ── OpenCode snapshots ───────────────────────────────────────────────────

export interface SnapshotPayload {
  opencodeVersion: string | null;
  providers: unknown;
  fetchedAt: string;
}

export async function saveOpencodeSnapshot(input: {
  opencodeVersion: string | null;
  providers: unknown;
  durationMs: number;
}): Promise<void> {
  await query(
    `INSERT INTO opencode_snapshots (opencode_version, providers, fetched_at, duration_ms)
     VALUES ($1, $2::jsonb, now(), $3)`,
    [input.opencodeVersion, JSON.stringify(input.providers ?? null), input.durationMs],
  );
  // Keep the table lean; only recent history is useful for diagnostics.
  await query(
    `DELETE FROM opencode_snapshots
      WHERE id NOT IN (SELECT id FROM opencode_snapshots ORDER BY fetched_at DESC LIMIT 20)`,
  );
}

export async function latestOpencodeSnapshot(): Promise<SnapshotPayload | null> {
  const row = await queryOne<{ opencode_version: string | null; providers: unknown; fetched_at: Date }>(
    'SELECT opencode_version, providers, fetched_at FROM opencode_snapshots ORDER BY fetched_at DESC LIMIT 1',
  );
  if (!row) return null;
  return {
    opencodeVersion: row.opencode_version,
    providers: row.providers,
    fetchedAt: new Date(row.fetched_at).toISOString(),
  };
}