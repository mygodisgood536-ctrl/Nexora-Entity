/** PostgreSQL pool + transaction helpers. */

import { Pool, type PoolClient, type QueryResultRow } from 'pg';
import { config } from '@nexora/core/config';
import { createLogger } from '@nexora/core';

const log = createLogger('db');

/**
 * The pool is held on globalThis rather than in module scope.
 *
 * A production Next build emits one module instance per route chunk, so a module-level
 * `let pool` creates a separate 12-connection pool for every route that touches the database.
 * Fifteen routes would open up to 180 connections against a server capped at 100, and the
 * surplus attempts are terminated mid-handshake — which surfaces to users as intermittent
 * "unexpected problem" errors rather than an obvious capacity problem. Anchoring the pool to the
 * process guarantees a single instance no matter how many chunks import this module.
 */
interface PoolHolder {
  __nexoraEntityPool?: Pool;
}

const holder = globalThis as typeof globalThis & PoolHolder;

export function getPool(): Pool {
  if (!holder.__nexoraEntityPool) {
    const pool = new Pool({
      connectionString: config().databaseUrl,
      // No `options` startup parameter. It used to carry `search_path` so unqualified table
      // names resolved inside a dedicated `nexora` schema, but a hosted connection pool
      // (Neon PgBouncer) refuses that parameter outright — "unsupported startup parameter in
      // options: search_path" — which failed every request before it reached a query. The
      // application tables now live in the default `public` schema, so no schema switching is
      // needed and the connection string works on pooled, direct and local PostgreSQL alike.
      // The postmaster caps this cluster at 100 connections, so the pool stays well under that
      // and must survive every route running at once.
      max: 12,
      // Short, so a connection is rarely held across a database restart or a long inspection
      // run. A stale client is the usual cause of "Connection terminated unexpectedly" surfacing
      // to a user as an unexplained error.
      idleTimeoutMillis: 15_000,
      // Generous, because a hosted pooled connection can take several seconds to establish on a
      // cold path. The previous 10s budget expired while the server was still opening the
      // socket, which surfaced as "Connection terminated due to connection timeout" — a failure
      // that looks like a database outage but is really the deadline being too short.
      connectionTimeoutMillis: 30_000,
      application_name: 'nexora-entity',
      // No TCP keepalive: on Windows it causes pg to hand out sockets the postmaster has
      // already closed, producing mid-query terminations that no retry can interpret.
      keepAlive: false,
    });
    pool.on('error', (err) => log.error('idle client error', { message: err.message }));
    holder.__nexoraEntityPool = pool;
    log.info('database pool created', { max: pool.options.max });
  }
  return holder.__nexoraEntityPool;
}

export async function closePool(): Promise<void> {
  if (holder.__nexoraEntityPool) {
    const p = holder.__nexoraEntityPool;
    holder.__nexoraEntityPool = undefined;
    await p.end();
  }
}

export async function query<T extends QueryResultRow = QueryResultRow>(
  text: string,
  params: readonly unknown[] = [],
): Promise<T[]> {
  const client = await getPool().connect();
  try {
    const res = await client.query<T>(text, params as unknown[]);
    return res.rows;
  } finally {
    client.release();
  }
}

export async function queryOne<T extends QueryResultRow = QueryResultRow>(
  text: string,
  params: readonly unknown[] = [],
): Promise<T | null> {
  const rows = await query<T>(text, params);
  return rows[0] ?? null;
}

export async function transaction<T>(fn: (tx: TxFn) => Promise<T>): Promise<T> {
  const client = await getPool().connect();
  const tx = makeTx(client);
  try {
    await client.query('BEGIN');
    const result = await fn(tx);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    try {
      await client.query('ROLLBACK');
    } catch {
      /* connection already broken */
    }
    throw err;
  } finally {
    client.release();
  }
}

function makeTx(client: PoolClient) {
  const tx = async <T extends QueryResultRow = QueryResultRow>(
    text: string,
    params: readonly unknown[] = [],
  ): Promise<T[]> => {
    const res = await client.query<T>(text, params as unknown[]);
    return res.rows;
  };
  return tx as TxFn;
}

export interface TxFn {
  <T extends QueryResultRow = QueryResultRow>(
    text: string,
    params?: readonly unknown[],
  ): Promise<T[]>;
}

export async function healthcheck(): Promise<{ ok: boolean; detail: string }> {
  try {
    await query('SELECT 1 AS ok');
    return { ok: true, detail: 'database reachable' };
  } catch (err) {
    return { ok: false, detail: err instanceof Error ? err.message : String(err) };
  }
}

/** Postgres returns numerics as strings; coerce the ones we read as numbers. */
export function num(v: unknown, dflt = 0): number {
  if (typeof v === 'number') return v;
  if (typeof v === 'string') {
    const n = Number.parseFloat(v);
    return Number.isFinite(n) ? n : dflt;
  }
  return dflt;
}

export function bool(v: unknown, dflt = false): boolean {
  if (typeof v === 'boolean') return v;
  if (v === 't') return true;
  if (v === 'f') return false;
  if (v === 1 || v === '1') return true;
  if (v === 0 || v === '0') return false;
  return dflt;
}

export function json<T>(v: unknown, dflt: T): T {
  if (v === null || v === undefined) return dflt;
  if (typeof v === 'string') {
    try {
      return JSON.parse(v) as T;
    } catch {
      return dflt;
    }
  }
  if (typeof v === 'object') return v as T;
  return dflt;
}

export function dateOrNull(v: unknown): Date | null {
  if (v instanceof Date) return v;
  if (typeof v === 'string') {
    const d = new Date(v);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  return null;
}

export function toIso(v: unknown): string | null {
  const d = dateOrNull(v);
  return d ? d.toISOString() : null;
}