/**
 * Monitoring and revalidation (spec §27).
 *
 * The platform keeps checking connected sources and detects possible changes. Nothing detected
 * becomes authoritative automatically: every change is presented to the person for review.
 */

import { config } from '@nexora/core/config';
import { createLogger } from '@nexora/core';
import {
  claimJob,
  completeJob,
  countPendingReviewItems,
  dueJobs,
  enqueueJob,
  findEntityById,
  insertReviewItem,
  listClaims,
  listDomains,
  listSources,
  liveDeployment,
  pendingJobsForEntity,
  publishedEntitiesNeedingRecheck,
  updateEntityStatus,
} from '@nexora/db';
import { detectAndStoreConflicts, detectAndStoreAmbiguity, buildSubjectProfile, buildReadinessReport, resolveIdentities, buildProvenance } from '@nexora/engine';
import { verifyCustomDomain } from './domains';
import { deployEntity } from './deploy';
import type { JobKind } from '@nexora/core';

const log = createLogger('monitor');

export const REVALIDATION_INTERVAL_HOURS = 72;

export async function scheduleRevalidation(entityId: string, kind: JobKind, delayHours = 0): Promise<void> {
  await enqueueJob({
    entityId,
    kind,
    nextRunAt: new Date(Date.now() + delayHours * 3_600_000),
  });
}

/** Re-check every source of an entity and surface any detected change for review. */
export async function recheckEntity(entityId: string): Promise<{
  checked: number;
  changes: number;
  readinessScore: number;
  readinessStatus: string;
}> {
  const entity = await findEntityById(entityId);
  if (!entity) throw new Error(`entity ${entityId} not found`);

  const before = await listSources(entityId);
  const beforeMap = new Map(before.map((s) => [s.canonical_url, { title: s.title, access: s.access_status, inspected: s.inspection_status }]));

  const claims = await listClaims(entityId);
  const subject = buildSubjectProfile(claims, before);
  await resolveIdentities(entityId, subject);
  await buildProvenance(entityId);
  await detectAndStoreConflicts(entityId);
  await detectAndStoreAmbiguity(entityId, subject);

  const after = await listSources(entityId);
  let changes = 0;
  for (const s of after) {
    const prev = beforeMap.get(s.canonical_url);
    if (!prev) continue;
    if (prev.access !== s.access_status) {
      changes += 1;
      await insertReviewItem({
        entityId,
        kind: 'change_detected',
        title: `Reachability changed for ${s.title ?? s.canonical_url}`,
        detail: `Nexora Entity previously recorded this source as "${prev.access}" and it is now "${s.access_status}". This has not changed anything about your entity until you decide.`,
        proposed: { url: s.canonical_url, before: prev.access, after: s.access_status },
        sourceId: s.id,
        stageKey: 'N_websites',
        blocking: false,
      });
    } else if (prev.title !== s.title) {
      changes += 1;
      await insertReviewItem({
        entityId,
        kind: 'change_detected',
        title: `Title changed for ${s.canonical_url}`,
        detail: `The title of this page changed from "${prev.title ?? '(none)'}" to "${s.title ?? '(none)'}". Review and accept if you want the new wording published.`,
        proposed: { url: s.canonical_url, before: prev.title, after: s.title },
        sourceId: s.id,
        blocking: false,
      });
    }
  }

  const report = await buildReadinessReport(entityId);
  await updateEntityStatus(entityId, report.status === 'ready' ? 'ready' : entity.status === 'published' ? 'published' : 'in_review');

  log.info('entity rechecked', { entityId, checked: after.length, changes, score: report.score });
  return { checked: after.length, changes, readinessScore: report.score, readinessStatus: report.status };
}

/** Run every due job. Called by the scheduled endpoint and by the CLI. */
export async function runDueJobs(limit = 10): Promise<{ processed: number; failed: number; summary: string[] }> {
  const jobs = await dueJobs(limit);
  let processed = 0;
  let failed = 0;
  const summary: string[] = [];

  for (const job of jobs) {
    const claimed = await claimJob(job.id);
    if (!claimed) continue;
    processed += 1;
    try {
      switch (job.kind) {
        case 'source_recheck': {
          const r = await recheckEntity(job.entity_id);
          summary.push(`source_recheck ${job.entity_id}: ${r.checked} sources, ${r.changes} change(s), readiness ${r.readinessScore}%`);
          await completeJob(job.id, nextRun(Date.now() + REVALIDATION_INTERVAL_HOURS * 3_600_000));
          break;
        }
        case 'freshness_sweep': {
          const r = await recheckEntity(job.entity_id);
          summary.push(`freshness_sweep ${job.entity_id}: readiness ${r.readinessScore}%`);
          await completeJob(job.id, nextRun(Date.now() + REVALIDATION_INTERVAL_HOURS * 3_600_000));
          break;
        }
        case 'publish_refresh': {
          const live = await liveDeployment(job.entity_id);
          if (!live) {
            summary.push(`publish_refresh ${job.entity_id}: no live deployment, nothing to do`);
            await completeJob(job.id);
            break;
          }
          const entity = await findEntityById(job.entity_id);
          const out = await deployEntity({ entityId: job.entity_id, userId: entity?.user_id ?? '', target: live.target });
          summary.push(`publish_refresh ${job.entity_id}: redeployed to ${out.url}`);
          await completeJob(job.id, nextRun(Date.now() + REVALIDATION_INTERVAL_HOURS * 3_600_000));
          break;
        }
        case 'domain_verify': {
          const domains = await listDomains(job.entity_id);
          for (const d of domains.filter((x) => x.kind === 'custom' && x.status !== 'active')) {
            const r = await verifyCustomDomain(job.entity_id, d.hostname);
            summary.push(`domain_verify ${d.hostname}: ${r.verified ? 'active' : 'pending'}`);
          }
          await completeJob(job.id, nextRun(Date.now() + 3_600_000));
          break;
        }
      }
    } catch (err) {
      failed += 1;
      const message = err instanceof Error ? err.message : String(err);
      log.error('revalidation job failed', { jobId: job.id, kind: job.kind, message });
      await completeJob(job.id, undefined, message);
    }
  }

  return { processed, failed, summary };
}

function nextRun(at: number): Date {
  return new Date(Math.max(at, Date.now() + 60_000));
}

/** Scheduled maintenance: ensure every published entity is being watched. */
export async function maintainPublishedEntities(): Promise<{ scheduled: number; alreadyWatching: number }> {
  const entities = await publishedEntitiesNeedingRecheck(REVALIDATION_INTERVAL_HOURS);
  let scheduled = 0;
  let alreadyWatching = 0;
  for (const e of entities) {
    const pending = await pendingJobsForEntity(e.id);
    if (pending.some((j) => j.kind === 'source_recheck')) {
      alreadyWatching += 1;
      continue;
    }
    await scheduleRevalidation(e.id, 'source_recheck');
    await scheduleRevalidation(e.id, 'freshness_sweep', REVALIDATION_INTERVAL_HOURS / 2);
    const live = await liveDeployment(e.id);
    if (live) await scheduleRevalidation(e.id, 'publish_refresh', REVALIDATION_INTERVAL_HOURS * 2);
    scheduled += 1;
  }
  log.info('maintenance sweep complete', { scheduled, alreadyWatching, total: entities.length });
  return { scheduled, alreadyWatching };
}

/** A small readiness/health summary for the platform status screen. */
export async function platformStatus(): Promise<{
  database: { ok: boolean; detail: string };
  openCode: { healthy: boolean; version: string | null; detail: string };
  vercel: { configured: boolean; reachable: boolean; detail: string };
  jobs: { pending: number };
}> {
  const { healthcheck, query } = await import('@nexora/db');
  const { health } = await import('@nexora/opencode-bridge');
  const { vercelDiagnostics } = await import('./vercel');

  const db = await healthcheck();
  const oc = await health();
  const vercel = await vercelDiagnostics();
  const pending = await query<{ n: number }>(
    "SELECT count(*)::int AS n FROM revalidation_jobs WHERE status = 'pending'",
  );

  return {
    database: db,
    openCode: { healthy: oc.healthy, version: oc.version, detail: oc.detail },
    vercel: { configured: vercel.configured, reachable: vercel.reachable, detail: vercel.detail },
    jobs: { pending: pending[0]?.n ?? 0 },
  };
}

export { config, countPendingReviewItems };