/**
 * Custom domains, deployments, revalidation jobs.
 *
 * In-memory mirror of `repos-deploy.ts`.
 */

import type { DomainKind, DomainStatus, DeploymentStatus, DeploymentTarget, JobKind, JobStatus } from '@nexora/core';
import { mem, clone, now, type Row } from './memory-store';
import type { DomainRecord, DeploymentRecord, RevalidationJobRecord } from './repos-deploy';

const table = (name: string): Row[] => mem.table(name);
const uid = (): string => mem.uid();
const rows = <T,>(name: string): T[] => table(name) as unknown as T[];
const find = <T,>(name: string, match: (r: Row) => boolean): T | null =>
  (table(name).find(match) as unknown as T | undefined) ?? null;
const ASC = (v: unknown): number => new Date(String(v ?? 0)).getTime();

// ── domains ─────────────────────────────────────────────────────────────────

export async function listDomains(entityId: string): Promise<DomainRecord[]> {
  return rows<DomainRecord>('domains')
    .filter((d) => d.entity_id === entityId)
    .sort((a, b) => (b.is_primary ? 1 : 0) - (a.is_primary ? 1 : 0) || ASC(a.created_at) - ASC(b.created_at))
    .map((d) => clone(d));
}

export async function getDomainByHostname(hostname: string): Promise<DomainRecord | null> {
  return clone(find<DomainRecord>('domains', (r) => r['hostname'] === hostname.toLowerCase()));
}

export async function getDomain(id: string): Promise<DomainRecord | null> {
  return clone(find<DomainRecord>('domains', (r) => r['id'] === id));
}

/** Mirrors `ON CONFLICT (entity_id, hostname) DO UPDATE`: re-adding refreshes DNS, not status. */
export async function insertDomain(input: {
  entityId: string;
  hostname: string;
  kind: DomainKind;
  verificationToken: string;
  dnsRecords: DomainRecord['dns_records'];
  status?: DomainStatus;
  isPrimary?: boolean;
}): Promise<DomainRecord> {
  const hostname = input.hostname.toLowerCase();
  const existing = find<Row>('domains', (r) => r['entity_id'] === input.entityId && r['hostname'] === hostname);
  if (existing) {
    existing['dns_records'] = clone(input.dnsRecords);
    existing['verification_token'] = input.verificationToken;
    existing['updated_at'] = now();
    return clone(existing) as unknown as DomainRecord;
  }
  const record: DomainRecord = {
    id: uid(),
    entity_id: input.entityId,
    hostname,
    kind: input.kind,
    status: input.status ?? 'pending_dns',
    verification_token: input.verificationToken,
    dns_records: clone(input.dnsRecords),
    is_primary: input.isPrimary ?? false,
    verified_at: null,
    last_checked_at: null,
    check_detail: null,
    created_at: now(),
    updated_at: now(),
  };
  table('domains').push(record as unknown as Row);
  return clone(record);
}

export async function setDomainStatus(
  domainId: string,
  status: DomainStatus,
  detail?: string | null,
): Promise<void> {
  const row = find<Row>('domains', (r) => r['id'] === domainId);
  if (!row) return;
  row['status'] = status;
  if (status === 'active') row['verified_at'] = now();
  row['last_checked_at'] = now();
  if (detail !== null && detail !== undefined) row['check_detail'] = detail;
  row['updated_at'] = now();
}

/** At most one primary domain per entity, so publishing can never resolve two hostnames at once. */
export async function makeDomainPrimary(domainId: string, entityId: string): Promise<void> {
  for (const row of table('domains')) {
    if (row['entity_id'] === entityId) row['is_primary'] = false;
  }
  const target = find<Row>('domains', (r) => r['id'] === domainId);
  if (target) {
    target['is_primary'] = true;
    target['updated_at'] = now();
  }
}

export async function renameDomain(domainId: string, hostname: string): Promise<void> {
  const row = find<Row>('domains', (r) => r['id'] === domainId);
  if (!row) return;
  row['hostname'] = hostname.toLowerCase();
  row['updated_at'] = now();
}

/** Removal is soft: the row is kept so published sites that still point at it can be reasoned about. */
export async function removeDomain(domainId: string): Promise<void> {
  const row = find<Row>('domains', (r) => r['id'] === domainId);
  if (!row) return;
  row['status'] = 'removed';
  row['is_primary'] = false;
  row['updated_at'] = now();
}

// ── deployments ─────────────────────────────────────────────────────────────

export async function createDeployment(input: {
  entityId: string;
  target: DeploymentTarget;
  attempt?: number;
  buildHash?: string;
  log?: string;
}): Promise<DeploymentRecord> {
  const created = now();
  const record: DeploymentRecord = {
    id: uid(),
    entity_id: input.entityId,
    target: input.target,
    status: 'queued' as DeploymentStatus,
    attempt: input.attempt ?? 1,
    provider_deployment_id: null,
    provider_project_id: null,
    url: null,
    build_hash: input.buildHash ?? null,
    site_bytes: null,
    file_count: null,
    validation: {},
    log: input.log ?? '',
    error: null,
    started_at: created,
    finished_at: null,
    created_at: created,
    updated_at: created,
  };
  table('deployments').push(record as unknown as Row);
  return clone(record);
}

/**
 * `logAppend` concatenates. Assigning it outright would destroy every earlier step, so the
 * publish console would only ever show the final chunk of a deployment log.
 */
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
  const row = find<Row>('deployments', (r) => r['id'] === deploymentId);
  if (!row) return;
  if (patch.status) row['status'] = patch.status;
  if (patch.providerDeploymentId !== undefined) row['provider_deployment_id'] = patch.providerDeploymentId;
  if (patch.providerProjectId !== undefined) row['provider_project_id'] = patch.providerProjectId;
  if (patch.buildHash !== undefined) row['build_hash'] = patch.buildHash;
  if (patch.url !== undefined) row['url'] = patch.url;
  if (patch.siteBytes !== undefined) row['site_bytes'] = patch.siteBytes;
  if (patch.fileCount !== undefined) row['file_count'] = patch.fileCount;
  if (patch.validation !== undefined) row['validation'] = clone(patch.validation);
  if (patch.error !== undefined) row['error'] = patch.error === null ? null : clone(patch.error);
  if (patch.logAppend !== undefined) {
    row['log'] = `${String(row['log'] ?? '')}${patch.logAppend}\n`;
  }
  if (patch.finished) row['finished_at'] = now();
  row['updated_at'] = now();
}

export async function getDeployment(id: string): Promise<DeploymentRecord | null> {
  return clone(find<DeploymentRecord>('deployments', (r) => r['id'] === id));
}

export async function listDeployments(entityId: string, limit = 20): Promise<DeploymentRecord[]> {
  return rows<DeploymentRecord>('deployments')
    .filter((d) => d.entity_id === entityId)
    .sort((a, b) => ASC(b.created_at) - ASC(a.created_at))
    .slice(0, limit)
    .map((d) => clone(d));
}

export async function liveDeployment(entityId: string): Promise<DeploymentRecord | null> {
  return clone(find<DeploymentRecord>('deployments', (r) => r['entity_id'] === entityId && r['status'] === 'live'));
}

/** Only one deployment may be `live` per entity at a time, so the published URL is unambiguous. */
export async function supersedeDeployments(entityId: string, exceptId: string | null): Promise<void> {
  for (const row of table('deployments')) {
    if (row['entity_id'] !== entityId || row['status'] !== 'live') continue;
    if (exceptId !== null && row['id'] === exceptId) continue;
    row['status'] = 'superseded';
    row['updated_at'] = now();
  }
}

// ── revalidation jobs ───────────────────────────────────────────────────────

export async function enqueueJob(input: {
  entityId: string;
  kind: JobKind;
  payload?: Record<string, unknown>;
  nextRunAt?: Date;
}): Promise<RevalidationJobRecord> {
  const record: RevalidationJobRecord = {
    id: uid(),
    entity_id: input.entityId,
    kind: input.kind,
    status: 'pending' as JobStatus,
    attempts: 0,
    payload: clone(input.payload ?? {}),
    last_error: null,
    next_run_at: input.nextRunAt ?? now(),
    last_run_at: null,
    created_at: now(),
  };
  table('revalidation_jobs').push(record as unknown as Row);
  return clone(record);
}

export async function dueJobs(limit = 20): Promise<RevalidationJobRecord[]> {
  const cutoff = now().getTime();
  return rows<RevalidationJobRecord>('revalidation_jobs')
    .filter((j) => j.status === 'pending' && ASC(j.next_run_at) <= cutoff)
    .sort((a, b) => ASC(a.next_run_at) - ASC(b.next_run_at))
    .slice(0, limit)
    .map((j) => clone(j));
}

/** Returns false when the job was already claimed or finished, so two workers cannot both run it. */
export async function claimJob(jobId: string): Promise<boolean> {
  const row = find<Row>('revalidation_jobs', (r) => r['id'] === jobId);
  if (!row || row['status'] !== 'pending') return false;
  row['status'] = 'running';
  row['attempts'] = (Number(row['attempts']) || 0) + 1;
  row['last_run_at'] = now();
  return true;
}

export async function completeJob(jobId: string, nextRunAt?: Date, error?: string | null): Promise<void> {
  const row = find<Row>('revalidation_jobs', (r) => r['id'] === jobId);
  if (!row) return;
  if (error) {
    row['status'] = 'failed';
    row['last_error'] = error;
    return;
  }
  row['status'] = 'done';
  row['last_error'] = null;
  row['next_run_at'] = nextRunAt ?? new Date(Date.now() + 86_400_000);
}

export async function pendingJobsForEntity(entityId: string): Promise<RevalidationJobRecord[]> {
  return rows<RevalidationJobRecord>('revalidation_jobs')
    .filter((j) => j.entity_id === entityId && (j.status === 'pending' || j.status === 'failed'))
    .sort((a, b) => ASC(a.next_run_at) - ASC(b.next_run_at))
    .map((j) => clone(j));
}

export async function publishedEntitiesNeedingRecheck(
  hours = 72,
): Promise<{ id: string; slug: string; updated_at: Date; published_at: Date }[]> {
  const cutoff = now().getTime() - hours * 3_600_000;
  return rows<Record<string, unknown>>('entities')
    .filter((e) => e['status'] === 'published' && e['published_at'] !== null && ASC(e['updated_at']) < cutoff)
    .map((e) => ({
      id: String(e['id']),
      slug: String(e['slug']),
      updated_at: e['updated_at'] as Date,
      published_at: e['published_at'] as Date,
    }));
}