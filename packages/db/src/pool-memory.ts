/**
 * Memory stand-in for `pool.ts`.
 *
 * Every repository function is mirrored natively, so the only SQL that ever reaches this module
 * is the handful of statements written inline by callers. Each is recognised explicitly and
 * served from the same tables the repositories use. Anything unrecognised throws rather than
 * quietly returning empty rows, so a test can never pass because a query silently matched nothing.
 */

import { mem, type Row } from './memory-store';

export interface TxFn {
  <T extends Record<string, unknown> = Record<string, unknown>>(
    text: string,
    params?: readonly unknown[],
  ): Promise<T[]>;
}

const norm = (s: string): string => s.replace(/\s+/g, ' ').trim();

/** Replace each `$n` with a parameter, returning the literal or the parameter index. */
const statements: { test: RegExp; run: (p: readonly unknown[]) => Row[] }[] = [
  {
    // pipeline.ts → attachClaimSource
    test: /^UPDATE claims SET source_id = (\$\d), independence_group = (\$\d), updated_at = now\(\) WHERE id = (\$\d) AND entity_id = (\$\d)$/,
    run: (p) => {
      const [src, grp, id, entity] = p.map((v) => String(v));
      for (const row of mem.table('claims')) {
        if (String(row['id']) === id && String(row['entity_id']) === entity) {
          row['source_id'] = src;
          row['independence_group'] = grp;
          row['updated_at'] = new Date();
        }
      }
      return [];
    },
  },
  {
    // pipeline.ts → independenceGroupOf
    test: /^SELECT independence_group, registrable_domain, host FROM sources WHERE id = (\$\d)$/,
    run: (p) => {
      const row = mem.table('sources').find((r) => String(r['id']) === String(p[0]));
      if (!row) return [];
      return [
        {
          independence_group: row['independence_group'] ?? null,
          registrable_domain: row['registrable_domain'] ?? null,
          host: row['host'] ?? null,
        },
      ];
    },
  },
  {
    // photos route → perceptual-hash duplicate detection
    test: /^SELECT id, perceptual_hash FROM photos WHERE entity_id = (\$\d) AND id <> (\$\d)$/,
    run: (p) => {
      const [entityId, selfId] = p.map((v) => String(v));
      return mem
        .table('photos')
        .filter((r) => String(r['entity_id']) === entityId && String(r['id']) !== selfId)
        .map((r) => ({ id: r['id'], perceptual_hash: r['perceptual_hash'] ?? null }));
    },
  },
  {
    // monitoring.ts → pendingJobCount
    test: /^SELECT count\(\*\)::int AS n FROM revalidation_jobs WHERE status = 'pending'$/,
    run: () => [{ n: mem.table('revalidation_jobs').filter((r) => r['status'] === 'pending').length }],
  },
];

export async function query<T extends Record<string, unknown> = Record<string, unknown>>(
  text: string,
  params: readonly unknown[] = [],
): Promise<T[]> {
  const sql = norm(text);
  for (const s of statements) {
    if (s.test.test(sql)) return s.run(params) as T[];
  }
  throw new Error(
    `The in-memory database double does not implement this statement:\n${sql}\n\n` +
      'Mirror it in pool-memory.ts, or move the caller behind a repository function.',
  );
}

export async function queryOne<T extends Record<string, unknown> = Record<string, unknown>>(
  text: string,
  params: readonly unknown[] = [],
): Promise<T | null> {
  const rows = await query<T>(text, params);
  return rows[0] ?? null;
}

/**
 * The memory tables have no isolation to preserve, so a transaction runs the body directly. A
 * throwing body propagates naturally; there is nothing to roll back.
 */
export async function transaction<T>(fn: (tx: TxFn) => Promise<T>): Promise<T> {
  return fn(query as unknown as TxFn);
}

export async function closePool(): Promise<void> {
  /* no connection to release */
}

export async function healthcheck(): Promise<{ ok: boolean; detail: string }> {
  return { ok: true, detail: 'in-memory test double (not durable, not a real database)' };
}

export async function getPool(): Promise<never> {
  throw new Error('The in-memory database double has no connection pool.');
}

export function num(v: unknown, dflt = 0): number {
  if (typeof v === 'number') return v;
  const n = Number.parseInt(String(v ?? ''), 10);
  return Number.isNaN(n) ? dflt : n;
}

export function bool(v: unknown, dflt = false): boolean {
  if (typeof v === 'boolean') return v;
  if (v === 't' || v === 'true' || v === '1') return true;
  if (v === 'f' || v === 'false' || v === '0') return false;
  return dflt;
}

export function json<T>(v: unknown, dflt: T): T {
  if (v === null || v === undefined) return dflt;
  if (typeof v === 'object') return v as T;
  try {
    return JSON.parse(String(v)) as T;
  } catch {
    return dflt;
  }
}

export function dateOrNull(v: unknown): Date | null {
  return v ? new Date(String(v)) : null;
}

export function toIso(v: unknown): string | null {
  if (!v) return null;
  const d = v instanceof Date ? v : new Date(String(v));
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}