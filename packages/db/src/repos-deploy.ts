/** Domains, deployments, revalidation jobs. */

import type { DeploymentStatus, DeploymentTarget, DomainKind, DomainStatus, JobKind, JobStatus } from '@nexora/core';
import { bool, json, num, query, queryOne } from './pool';

export interface DomainRecord {
  id: string;
  entity_id: string;
  hostname: string;
  kind: DomainKind;
  status: DomainStatus;
  verification_token: string | null;
  dns_records: { type: string; name: string; value: string; ttl?: number; purpose: string }[];
  is_primary: boolean;
  verified_at: Date | null;
  last_checked_at: Date | null;
  check_detail: string | null;
  created_at: Date;
  updated_at: Date;
}

function mapDomain(r: Record<string, unknown>): DomainRecord {
  return {
    ...(r as unknown as DomainRecord),
    dns_records: json(r.dns_records, [] as DomainRecord['dns_records']),
    is_primary: bool(r.is_primary),
  };
}

export async function listDomains(entityId: string): Promise<DomainRecord[]> {
  const rows = await query<Record<string, unknown>>(
    'SELECT * FROM domains WHERE entity_id = $1 ORDER BY is_primary DESC, created_at ASC',
    [entityId],
  );
  return rows.map(mapDomain);
}

export async function getDomainByHostname(hostname: string): Promise<DomainRecord | null> {
  const row = await queryOne<Record<string, unknown>>(
    'SELECT * FROM domains WHERE hostname = $1 AND status <> $2',
    [hostname.toLowerCase(), 'removed'],
  );
  return row ? mapDomain(row) : null;
}

export async function getDomain(id: string): Promise<DomainRecord | null> {
  const row = await queryOne<Record<string, unknown>>('SELECT * FROM domains WHERE id = $1', [id]);
  return row ? mapDomain(row) : null;
}

export async function insertDomain(input: {
  entityId: string;
  hostname: string;
  kind: DomainKind;
  verificationToken: string;
  dnsRecords: DomainRecord['dns_records'];
  status?: DomainStatus;
  isPrimary?: boolean;
}): Promise<DomainRecord> {
  const row = await queryOne<Record<string, unknown>>(
    `INSERT INTO domains (entity_id, hostname, kind, status, verification_token, dns_records, is_primary)
     VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7)
     ON CONFLICT (entity_id, hostname) DO UPDATE
       SET dns_records = EXCLUDED.dns_records, verification_token = EXCLUDED.verification_token,
           updated_at = now()
     RETURNING *`,
    [
      input.entityId,
      input.hostname.toLowerCase(),
      input.kind,
      input.status ?? 'pending_dns',
      input.verificationToken,
      JSON.stringify(input.dnsRecords),
      input.isPrimary ?? false,
    ],
  );
  if (!row) throw new Error('insertDomain returned no row');
  return mapDomain(row);
}

export async function setDomainStatus(
  domainId: string,
  status: DomainStatus,
  detail?: string | null,
): Promise<void> {
  await query(
    `UPDATE domains SET status = $2,
            verified_at = CASE WHEN $2 = 'active' THEN now() ELSE verified_at END,
            last_checked_at = now(), check_detail = COALESCE($3, check_detail), updated_at = now()
      WHERE id = $1`,
    [domainId, status, detail ?? null],
  );
}

export async function makeDomainPrimary(domainId: string, entityId: string): Promise<void> {
  await query('UPDATE domains SET is_primary = false WHERE entity_id = $1', [entityId]);
  await query('UPDATE domains SET is_primary = true WHERE id = $1', [domainId]);
}

export async function renameDomain(domainId: string, hostname: string): Promise<void> {
  await query('UPDATE domains SET hostname = $2, updated_at = now() WHERE id = $1', [
    domainId,
    hostname.toLowerCase(),
  ]);
}

export async function removeDomain(domainId: string): Promise<void> {
  await query(`UPDATE domains SET status = 'removed', is_primary = false, updated_at = now() WHERE id = $1`, [
    domainId,
  ]);
}

// ── Deployments ──────────────────────────────────────────────────────────

export interface DeploymentRecord {
  id: string;
  entity_id: string;
  target: DeploymentTarget;
  status: DeploymentStatus;
  attempt: number;
  provider_deployment_id: string | null;
  provider_project_id: string | null;
  url: string | null;
  build_hash: string | null;
  site_bytes: number | null;
  file_count: number | null;
  validation: Record<string, unknown>;
  log: string;
  error: Record<string, unknown> | null;
  started_at: Date | null;
  finished_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

function mapDeployment(r: Record<string, unknown>): DeploymentRecord {
  return {
    ...(r as unknown as DeploymentRecord),
    validation: json(r.validation, {} as Record<string, unknown>),
    error: r.error ? json(r.error, {} as Record<string, unknown>) : null,
    attempt: num(r.attempt),
    site_bytes: r.site_bytes === null || r.site_bytes === undefined ? null : num(r.site_bytes),
    file_count: r.file_count === null || r.file_count === undefined ? null : num(r.file_count),
  };
}

export async function createDeployment(input: {
  entityId: string;
  target: DeploymentTarget;
  attempt?: number;
  buildHash?: string;
  log?: string;
}): Promise<DeploymentRecord> {
  const row = await queryOne<Record<string, unknown>>(
    `INSERT INTO deployments (entity_id, target, attempt, build_hash, log, status, started_at)
     VALUES ($1,$2,$3,$4,$5,'queued', now()) RETURNING *`,
    [input.entityId, input.target, input.attempt ?? 1, input.buildHash ?? null, input.log ?? ''],
  );
  if (!row) throw new Error('createDeployment returned no row');
  return mapDeployment(row);
}

export async function updateDeployment(
  deploymentId: string,
  patch: Partial<{
    status: DeploymentStatus;
    providerDeploymentId: string;
    providerProjectId: string;
    buildHash: string;
    url: string;
    siteBytes: number;
    fileCount: number;
    validation: Record<string, unknown>;
    error: Record<string, unknown> | null;
    logAppend: string;
    finished: boolean;
  }>,
): Promise<void> {
  const sets: string[] = ['updated_at = now()'];
  const params: unknown[] = [deploymentId];
  const push = (col: string, value: unknown) => {
    params.push(value);
    sets.push(`${col} = $${params.length}`);
  };
  if (patch.status) push('status', patch.status);
  if (patch.providerDeploymentId !== undefined) push('provider_deployment_id', patch.providerDeploymentId);
  if (patch.providerProjectId !== undefined) push('provider_project_id', patch.providerProjectId);
  if (patch.buildHash !== undefined) push('build_hash', patch.buildHash);
  if (patch.url !== undefined) push('url', patch.url);
  if (patch.siteBytes !== undefined) push('site_bytes', patch.siteBytes);
  if (patch.fileCount !== undefined) push('file_count', patch.fileCount);
  if (patch.validation !== undefined) push('validation', JSON.stringify(patch.validation));
  if (patch.error !== undefined) push('error', patch.error === null ? null : JSON.stringify(patch.error));
  if (patch.logAppend !== undefined) push('log', `${patch.logAppend}\n`);
  if (patch.finished) sets.push('finished_at = now()');
  await query(`UPDATE deployments SET ${sets.join(', ')} WHERE id = $1`, params);
}

export async function getDeployment(id: string): Promise<DeploymentRecord | null> {
  const row = await queryOne<Record<string, unknown>>('SELECT * FROM deployments WHERE id = $1', [id]);
  return row ? mapDeployment(row) : null;
}

export async function listDeployments(entityId: string, limit = 20): Promise<DeploymentRecord[]> {
  const rows = await query<Record<string, unknown>>(
    'SELECT * FROM deployments WHERE entity_id = $1 ORDER BY created_at DESC LIMIT $2',
    [entityId, limit],
  );
  return rows.map(mapDeployment);
}

export async function liveDeployment(entityId: string): Promise<DeploymentRecord | null> {
  const row = await queryOne<Record<string, unknown>>(
    `SELECT * FROM deployments WHERE entity_id = $1 AND status = 'live' LIMIT 1`,
    [entityId],
  );
  return row ? mapDeployment(row) : null;
}

export async function supersedeDeployments(entityId: string, exceptId: string | null): Promise<void> {
  await query(
    `UPDATE deployments SET status = 'superseded', updated_at = now()
      WHERE entity_id = $1 AND status = 'live' AND ($2::uuid IS NULL OR id <> $2::uuid)`,
    [entityId, exceptId],
  );
}

// ── Revalidation jobs ────────────────────────────────────────────────────

export interface RevalidationJobRecord {
  id: string;
  entity_id: string;
  kind: JobKind;
  status: JobStatus;
  attempts: number;
  payload: Record<string, unknown>;
  last_error: string | null;
  next_run_at: Date;
  last_run_at: Date | null;
  created_at: Date;
}

export async function enqueueJob(input: {
  entityId: string;
  kind: JobKind;
  payload?: Record<string, unknown>;
  nextRunAt?: Date;
}): Promise<RevalidationJobRecord> {
  const rows = await query<RevalidationJobRecord>(
    `INSERT INTO revalidation_jobs (entity_id, kind, payload, next_run_at)
     VALUES ($1,$2,$3::jsonb,$4) RETURNING *`,
    [input.entityId, input.kind, JSON.stringify(input.payload ?? {}), input.nextRunAt ?? new Date()],
  );
  const row = rows[0];
  if (!row) throw new Error('enqueueJob returned no row');
  return row;
}

export async function dueJobs(limit = 20): Promise<RevalidationJobRecord[]> {
  const rows = await query<RevalidationJobRecord>(
    `SELECT * FROM revalidation_jobs
      WHERE status = 'pending' AND next_run_at <= now()
      ORDER BY next_run_at ASC LIMIT $1`,
    [limit],
  );
  return rows.map((r) => ({ ...r, payload: json(r.payload, {} as Record<string, unknown>) }));
}

export async function claimJob(jobId: string): Promise<boolean> {
  const rows = await query<{ id: string }>(
    `UPDATE revalidation_jobs SET status = 'running', attempts = attempts + 1, last_run_at = now()
      WHERE id = $1 AND status = 'pending' RETURNING id`,
    [jobId],
  );
  return rows.length > 0;
}

export async function completeJob(jobId: string, nextRunAt?: Date, error?: string | null): Promise<void> {
  if (error) {
    await query(
      `UPDATE revalidation_jobs SET status = 'failed', last_error = $2 WHERE id = $1`,
      [jobId, error],
    );
    return;
  }
  await query(
    `UPDATE revalidation_jobs SET status = 'done', last_error = NULL, next_run_at = $2 WHERE id = $1`,
    [jobId, nextRunAt ?? new Date(Date.now() + 86_400_000)],
  );
}

export async function pendingJobsForEntity(entityId: string): Promise<RevalidationJobRecord[]> {
  return query<RevalidationJobRecord>(
    'SELECT * FROM revalidation_jobs WHERE entity_id = $1 AND status IN ($2,$3) ORDER BY next_run_at ASC',
    [entityId, 'pending', 'failed'],
  );
}

export async function publishedEntitiesNeedingRecheck(hours = 72): Promise<
  { id: string; slug: string; updated_at: Date; published_at: Date }[]
> {
  return query(
    `SELECT id, slug, updated_at, published_at FROM entities
      WHERE status = 'published' AND published_at IS NOT NULL
        AND updated_at < now() - ($1 || ' hours')::interval`,
    [String(hours)],
  );
}