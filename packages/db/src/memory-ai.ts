/**
 * AI provider configuration and OpenCode snapshots.
 *
 * In-memory mirror of `repos-ai.ts`.
 */

import { mem, clone, now, type Row } from './memory-store';
import type { AiConfigurationRecord, SnapshotPayload } from './repos-ai';

const table = (name: string): Row[] => mem.table(name);
const uid = (): string => mem.uid();
const rows = <T,>(name: string): T[] => table(name) as unknown as T[];
const find = <T,>(name: string, match: (r: Row) => boolean): T | null =>
  (table(name).find(match) as unknown as T | undefined) ?? null;
const ASC = (v: unknown): number => new Date(String(v ?? 0)).getTime();

export async function getActiveAiConfiguration(userId: string): Promise<AiConfigurationRecord | null> {
  return clone(find<AiConfigurationRecord>('ai_configurations', (r) => r['user_id'] === userId && r['is_active'] === true));
}

export async function listAiConfigurations(userId: string): Promise<AiConfigurationRecord[]> {
  return rows<AiConfigurationRecord>('ai_configurations')
    .filter((c) => c.user_id === userId)
    .sort((a, b) => ASC(b.created_at) - ASC(a.created_at))
    .map((c) => clone(c));
}

/**
 * Exactly one configuration may be active per user. Verifying a new provider must deactivate the
 * previous one and mark it `replaced`, so a half-switched account can never send work to a model
 * the user has already replaced.
 */
export async function upsertVerifiedAiConfiguration(input: {
  userId: string;
  providerId: string;
  providerName: string;
  modelId: string;
  modelName: string;
  verification: Record<string, unknown>;
}): Promise<AiConfigurationRecord> {
  const previous = await getActiveAiConfiguration(input.userId);
  for (const row of table('ai_configurations')) {
    if (row['user_id'] === input.userId && row['is_active'] === true) {
      row['is_active'] = false;
      row['updated_at'] = now();
    }
  }

  const record: AiConfigurationRecord = {
    id: uid(),
    user_id: input.userId,
    provider_id: input.providerId,
    provider_name: input.providerName,
    model_id: input.modelId,
    model_name: input.modelName,
    is_active: true,
    status: 'verified',
    verified_at: now(),
    verification: clone(input.verification),
    last_used_at: null,
    last_error: null,
    last_error_code: null,
    last_error_at: null,
    created_at: now(),
    updated_at: now(),
  };
  table('ai_configurations').push(record as unknown as Row);

  if (previous) {
    const old = find<Row>('ai_configurations', (r) => r['id'] === previous.id);
    if (old) {
      old['status'] = 'replaced';
      old['updated_at'] = now();
    }
  }
  return clone(record);
}

export async function markAiConfigurationFailed(
  userId: string,
  input: { error: string; code: string },
): Promise<void> {
  for (const row of table('ai_configurations')) {
    if (row['user_id'] === userId && row['is_active'] === true) {
      row['status'] = 'failed';
      row['last_error'] = input.error;
      row['last_error_code'] = input.code;
      row['last_error_at'] = now();
      row['updated_at'] = now();
    }
  }
}

export async function touchAiConfiguration(configId: string): Promise<void> {
  const row = find<Row>('ai_configurations', (r) => r['id'] === configId);
  if (!row) return;
  row['last_used_at'] = now();
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
  table('ai_provider_attempts').push({
    id: uid(),
    seq: ++attemptSeq,
    user_id: input.userId,
    config_id: input.configId ?? null,
    provider_id: input.providerId,
    model_id: input.modelId,
    operation: input.operation,
    outcome: input.outcome,
    failure_kind: input.failureKind ?? null,
    message: input.message ?? null,
    detail: clone(input.detail ?? {}),
    latency_ms: input.latencyMs ?? null,
    created_at: now(),
  });
}

export async function recentAiAttempts(userId: string, limit = 25) {
  // Ordered by id DESC in SQL; the memory table has no real ordering column, so use insertion order.
  return rows<Record<string, unknown>>('ai_provider_attempts')
    .filter((a) => a['user_id'] === userId)
    .sort((a, b) => numField(b['seq']) - numField(a['seq']))
    .slice(0, limit)
    .map((a) => ({
      provider_id: a['provider_id'],
      model_id: a['model_id'],
      operation: a['operation'],
      outcome: a['outcome'],
      failure_kind: a['failure_kind'],
      message: a['message'],
      created_at: a['created_at'],
    }));
}

export async function saveOpencodeSnapshot(input: {
  opencodeVersion: string | null;
  providers: unknown;
  durationMs: number;
}): Promise<void> {
  table('opencode_snapshots').push({
    id: uid(),
    opencode_version: input.opencodeVersion,
    providers: clone(input.providers ?? null),
    fetched_at: now(),
    duration_ms: input.durationMs,
  });
  // Keep the table lean, mirroring the SQL's prune to the twenty most recent.
  const all = rows<Row>('opencode_snapshots').sort((a, b) => ASC(b['fetched_at']) - ASC(a['fetched_at']));
  const keep = new Set(all.slice(0, 20).map((r) => String(r['id'])));
  const t = table('opencode_snapshots');
  const kept = t.filter((r) => keep.has(String(r['id'])));
  t.length = 0;
  t.push(...kept);
}

export async function latestOpencodeSnapshot(): Promise<SnapshotPayload | null> {
  const row = rows<Row>('opencode_snapshots').sort((a, b) => ASC(b['fetched_at']) - ASC(a['fetched_at']))[0];
  if (!row) return null;
  return {
    opencodeVersion: (row['opencode_version'] as string | null) ?? null,
    providers: row['providers'],
    fetchedAt: new Date(String(row['fetched_at'])).toISOString(),
  };
}

let attemptSeq = 0;
function numField(v: unknown): number {
  return typeof v === 'number' ? v : Number.parseInt(String(v ?? '0'), 10) || 0;
}