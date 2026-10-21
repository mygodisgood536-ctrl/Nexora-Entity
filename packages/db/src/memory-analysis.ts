/**
 * Claims, evidence, identity links, conflicts, ambiguities, review items, readiness runs.
 *
 * In-memory mirror of `repos-analysis.ts`. Semantics are kept faithful to the SQL so that a test
 * passing here means the same thing it will mean against the hosted PostgreSQL integration.
 */

import type {
  ConflictKind,
  ReadinessCheckId,
  ReadinessRunKind,
  ReadinessStatus,
  ResolutionStatus,
  ReviewKind,
  ReviewStatus,
  Severity,
} from '@nexora/core';
import { mem, clone, now, type Row } from './memory-store';
import type {
  ClaimRecord,
  ClaimInsert,
  CheckResult,
  BlockingIssue,
  EvidenceRecord,
  IdentityLinkRecord,
  ConflictRecord,
  AmbiguityRecord,
  ReviewItemRecord,
  ReadinessRunRecord,
  EvidenceMinimumsRecord,
} from './repos-analysis';

const table = (name: string): Row[] => mem.table(name);
const uid = (): string => mem.uid();

const rows = <T>(name: string): T[] => table(name) as unknown as T[];
const drop = (name: string, match: (r: Row) => boolean): number => {
  const t = table(name);
  const before = t.length;
  const kept = t.filter((r) => !match(r));
  t.length = 0;
  t.push(...kept);
  return before - t.length;
};
const find = <T>(name: string, match: (r: Row) => boolean): T | null =>
  (table(name).find(match) as unknown as T | undefined) ?? null;

const ASC = (v: unknown): number => new Date(String(v ?? 0)).getTime();

// ── claims ──────────────────────────────────────────────────────────────────

function mapClaim<T>(r: T): T {
  return clone(r) as T;
}

export async function listClaims(entityId: string): Promise<ClaimRecord[]> {
  return rows<ClaimRecord>('claims')
    .filter((c) => c.entity_id === entityId)
    .sort((a, b) => a.attribute_key.localeCompare(b.attribute_key) || a.sort_order - b.sort_order || ASC(a.created_at) - ASC(b.created_at));
}

export async function listClaimsByAttribute(entityId: string, attributeKey: string): Promise<ClaimRecord[]> {
  return rows<ClaimRecord>('claims')
    .filter((c) => c.entity_id === entityId && c.attribute_key === attributeKey)
    .sort((a, b) => ASC(a.created_at) - ASC(b.created_at));
}

export async function getClaim(id: string): Promise<ClaimRecord | null> {
  const c = find<ClaimRecord>('claims', (r) => r['id'] === id);
  return c ? mapClaim(c) : null;
}

/**
 * Mirrors the SQL: insert, and on duplicate return the pre-existing claim for the same
 * entity + attribute + value + source. Duplicates must never create a second row, because
 * readiness counts independence groups and duplicated claims would inflate them.
 */
export async function upsertClaim(input: ClaimInsert): Promise<ClaimRecord> {
  const sourceId = input.sourceId ?? null;
  const existing = rows<ClaimRecord>('claims')
    .filter(
      (c) =>
        c.entity_id === input.entityId &&
        c.attribute_key === input.attributeKey &&
        c.value_text === input.valueText &&
        c.source_id === sourceId,
    )
    .sort((a, b) => ASC(a.created_at) - ASC(b.created_at))[0];
  if (existing) return mapClaim(existing);

  const id = uid();
  const created = now();
  const claim: ClaimRecord = {
    id,
    entity_id: input.entityId,
    attribute_key: input.attributeKey,
    predicate: input.predicate,
    node_type: input.nodeType ?? null,
    value_text: input.valueText,
    value_json: input.valueJson ?? {},
    normalized_key: input.normalizedKey ?? null,
    origin: input.origin,
    status: input.status,
    support_strength: input.supportStrength ?? 'none',
    authority_tier: input.authorityTier ?? 1,
    confidence: input.confidence ?? 0,
    source_id: sourceId,
    independence_group: input.independenceGroup ?? null,
    period_start: input.periodStart ?? null,
    period_end: input.periodEnd ?? null,
    is_current: input.isCurrent ?? null,
    discovered_at: input.discovered ? created : null,
    verified_at: null,
    last_checked_at: null,
    conflicting: false,
    conflict_ids: [],
    publish: input.publish ?? false,
    user_confirmed: input.userConfirmed ?? false,
    stage_key: input.stageKey ?? null,
    display_label: input.displayLabel ?? null,
    sort_order: input.sortOrder ?? 0,
    created_at: created,
    updated_at: created,
  };
  table('claims').push(claim as unknown as Row);
  return clone(claim);
}

export async function updateClaimStatus(
  claimId: string,
  input: {
    status?: ClaimRecord['status'];
    supportStrength?: ClaimRecord['support_strength'];
    confidence?: number;
    publish?: boolean;
    userConfirmed?: boolean;
    conflicting?: boolean;
    verified?: boolean;
  },
): Promise<void> {
  const row = find<Row>('claims', (r) => r['id'] === claimId);
  if (!row) return;
  if (input.status !== undefined) row['status'] = input.status;
  if (input.supportStrength !== undefined) row['support_strength'] = input.supportStrength;
  if (input.confidence !== undefined) row['confidence'] = input.confidence;
  if (input.publish !== undefined) row['publish'] = input.publish;
  if (input.userConfirmed !== undefined) row['user_confirmed'] = input.userConfirmed;
  if (input.conflicting !== undefined) row['conflicting'] = input.conflicting;
  if (input.verified === true) row['verified_at'] = now();
  row['updated_at'] = now();
}

export async function attachClaimToConflicts(claimId: string, conflictIds: string[]): Promise<void> {
  const row = find<Row>('claims', (r) => r['id'] === claimId);
  if (!row) return;
  row['conflict_ids'] = [...conflictIds];
  row['updated_at'] = now();
}

export async function deleteClaim(claimId: string): Promise<void> {
  drop('claims', (r) => r['id'] === claimId);
}

export async function deleteClaimsForStage(entityId: string, stageKey: string): Promise<number> {
  return drop('claims', (r) => r['entity_id'] === entityId && r['stage_key'] === stageKey && r['origin'] === 'user');
}

export async function deleteDiscoveredClaims(entityId: string): Promise<number> {
  return drop('claims', (r) => r['entity_id'] === entityId && r['origin'] !== 'user');
}

// ── evidence ────────────────────────────────────────────────────────────────

export async function insertEvidence(input: {
  entityId: string;
  claimId?: string | null;
  sourceId?: string | null;
  kind: string;
  strength: number;
  independenceGroup?: string | null;
  detail?: string | null;
  payload?: Record<string, unknown>;
}): Promise<EvidenceRecord> {
  const record: EvidenceRecord = {
    id: uid(),
    entity_id: input.entityId,
    claim_id: input.claimId ?? null,
    source_id: input.sourceId ?? null,
    kind: input.kind,
    strength: input.strength,
    independence_group: input.independenceGroup ?? null,
    detail: input.detail ?? null,
    payload: input.payload ?? {},
    obtained_at: now(),
  };
  table('evidence').push(record as unknown as Row);
  return clone(record);
}

export async function listEvidence(entityId: string): Promise<EvidenceRecord[]> {
  return rows<EvidenceRecord>('evidence')
    .filter((e) => e.entity_id === entityId)
    .sort((a, b) => ASC(a.obtained_at) - ASC(b.obtained_at));
}

export async function listEvidenceForClaim(claimId: string): Promise<EvidenceRecord[]> {
  return rows<EvidenceRecord>('evidence')
    .filter((e) => e.claim_id === claimId)
    .sort((a, b) => ASC(a.obtained_at) - ASC(b.obtained_at));
}

export async function deleteEvidenceForSource(sourceId: string): Promise<void> {
  drop('evidence', (r) => r['source_id'] === sourceId);
}

// ── identity links ──────────────────────────────────────────────────────────

export async function listIdentityLinks(entityId: string): Promise<IdentityLinkRecord[]> {
  return rows<IdentityLinkRecord>('identity_links')
    .filter((l) => l.entity_id === entityId)
    .sort((a, b) => b.score - a.score);
}

export async function upsertIdentityLink(input: {
  entityId: string;
  sourceId: string;
  platform?: string | null;
  handle?: string | null;
  state: IdentityLinkRecord['resolved_state'];
  score: number;
  signals: Record<string, unknown>;
  rationale: string;
  method: string;
}): Promise<IdentityLinkRecord> {
  const existing = find<Row>('identity_links', (r) => r['entity_id'] === input.entityId && r['source_id'] === input.sourceId);
  const record: IdentityLinkRecord = {
    id: (existing?.['id'] as string | undefined) ?? uid(),
    entity_id: input.entityId,
    source_id: input.sourceId,
    platform: input.platform ?? null,
    handle: input.handle ?? null,
    resolved_state: input.state,
    score: input.score,
    signals: input.signals,
    rationale: input.rationale,
    method: input.method,
    // A re-evaluation must not silently overwrite a decision the user already made.
    user_decision: (existing?.['user_decision'] as IdentityLinkRecord['user_decision']) ?? null,
    evaluated_at: now(),
  };
  if (existing) Object.assign(existing, record);
  else table('identity_links').push(record as unknown as Row);
  return clone(record);
}

export async function setIdentityUserDecision(linkId: string, decision: 'accept' | 'reject'): Promise<void> {
  const row = find<Row>('identity_links', (r) => r['id'] === linkId);
  if (!row) return;
  row['user_decision'] = decision;
  row['evaluated_at'] = now();
}

// ── conflicts ───────────────────────────────────────────────────────────────

export async function listConflicts(entityId: string, openOnly = false): Promise<ConflictRecord[]> {
  return rows<ConflictRecord>('conflicts')
    .filter((c) => c.entity_id === entityId && (!openOnly || c.status === 'open'))
    .sort((a, b) => (a.severity === 'blocking' ? 1 : 0) - (b.severity === 'blocking' ? 1 : 0) || ASC(b.detected_at) - ASC(a.detected_at));
}

export async function getConflict(id: string): Promise<ConflictRecord | null> {
  return find<ConflictRecord>('conflicts', (r) => r['id'] === id);
}

export async function insertConflict(input: {
  entityId: string;
  attributeKey: string;
  kind: ConflictKind;
  severity: Severity;
  claimIds?: string[];
  sourceIds?: string[];
  description: string;
  userMessage?: string;
  evidence?: Record<string, unknown>;
}): Promise<ConflictRecord> {
  const record: ConflictRecord = {
    id: uid(),
    entity_id: input.entityId,
    attribute_key: input.attributeKey,
    kind: input.kind,
    severity: input.severity,
    claim_ids: input.claimIds ?? [],
    source_ids: input.sourceIds ?? [],
    description: input.description,
    user_message: input.userMessage ?? null,
    evidence: input.evidence ?? {},
    status: 'open' as ResolutionStatus,
    resolution_note: null,
    resolved_at: null,
    detected_at: now(),
  };
  table('conflicts').push(record as unknown as Row);
  return clone(record);
}

export async function resolveConflict(
  id: string,
  resolution: ResolutionStatus,
  note?: string | null,
): Promise<void> {
  const row = find<Row>('conflicts', (r) => r['id'] === id);
  if (!row) return;
  row['status'] = resolution;
  row['resolution_note'] = note ?? null;
  row['resolved_at'] = now();
}

export async function reopenConflictsForAttribute(entityId: string, attributeKey: string): Promise<void> {
  for (const row of table('conflicts')) {
    if (row['entity_id'] === entityId && row['attribute_key'] === attributeKey && row['status'] === 'resolved') {
      row['status'] = 'open';
      row['resolved_at'] = null;
    }
  }
}

// ── ambiguities ─────────────────────────────────────────────────────────────

export async function listAmbiguities(entityId: string, openOnly = false): Promise<AmbiguityRecord[]> {
  return rows<AmbiguityRecord>('ambiguities')
    .filter((a) => a.entity_id === entityId && (!openOnly || a.status === 'open'))
    .sort((a, b) => (a.severity === 'blocking' ? 1 : 0) - (b.severity === 'blocking' ? 1 : 0) || ASC(b.detected_at) - ASC(a.detected_at));
}

export async function insertAmbiguity(input: {
  entityId: string;
  dimension: string;
  description: string;
  candidates: unknown[];
  missingEvidence?: unknown[];
  severity: Severity;
}): Promise<AmbiguityRecord> {
  const record: AmbiguityRecord = {
    id: uid(),
    entity_id: input.entityId,
    dimension: input.dimension,
    description: input.description,
    candidates: input.candidates,
    missing_evidence: input.missingEvidence ?? [],
    severity: input.severity,
    status: 'open',
    resolution_note: null,
    resolved_at: null,
    detected_at: now(),
  };
  table('ambiguities').push(record as unknown as Row);
  return clone(record);
}

export async function resolveAmbiguity(
  id: string,
  status: 'resolved' | 'dismissed',
  note?: string | null,
): Promise<void> {
  const row = find<Row>('ambiguities', (r) => r['id'] === id);
  if (!row) return;
  row['status'] = status;
  row['resolution_note'] = note ?? null;
  row['resolved_at'] = now();
}

// ── review items ────────────────────────────────────────────────────────────

export async function listReviewItems(entityId: string, pendingOnly = false): Promise<ReviewItemRecord[]> {
  return rows<ReviewItemRecord>('review_items')
    .filter((i) => i.entity_id === entityId && (!pendingOnly || i.status === 'pending'))
    .sort((a, b) => (a.blocking ? 1 : 0) - (b.blocking ? 1 : 0) || ASC(a.created_at) - ASC(b.created_at));
}

export async function countPendingReviewItems(entityId: string): Promise<number> {
  return rows<ReviewItemRecord>('review_items').filter((i) => i.entity_id === entityId && i.status === 'pending').length;
}

export async function insertReviewItem(input: {
  entityId: string;
  kind: ReviewKind;
  title: string;
  detail?: string | null;
  proposed: Record<string, unknown>;
  sourceId?: string | null;
  claimId?: string | null;
  conflictId?: string | null;
  ambiguityId?: string | null;
  stageKey?: string | null;
  blocking?: boolean;
}): Promise<ReviewItemRecord> {
  // The SQL falls back to returning the existing item for the same conflict. Mirror that so a
  // re-run does not produce two review entries for one conflict.
  if (input.conflictId) {
    const existing = rows<ReviewItemRecord>('review_items').find((i) => i.conflict_id === input.conflictId);
    if (existing) return clone(existing);
  }
  const record: ReviewItemRecord = {
    id: uid(),
    entity_id: input.entityId,
    kind: input.kind,
    title: input.title,
    detail: input.detail ?? null,
    proposed: input.proposed ?? {},
    source_id: input.sourceId ?? null,
    claim_id: input.claimId ?? null,
    conflict_id: input.conflictId ?? null,
    ambiguity_id: input.ambiguityId ?? null,
    stage_key: input.stageKey ?? null,
    blocking: input.blocking ?? false,
    status: 'pending' as ReviewStatus,
    decision_note: null,
    created_at: now(),
    decided_at: null,
  };
  table('review_items').push(record as unknown as Row);
  return clone(record);
}

export async function getReviewItem(id: string): Promise<ReviewItemRecord | null> {
  return find<ReviewItemRecord>('review_items', (r) => r['id'] === id);
}

export async function decideReviewItem(id: string, status: ReviewStatus, note?: string | null): Promise<void> {
  const row = find<Row>('review_items', (r) => r['id'] === id);
  if (!row) return;
  row['status'] = status;
  row['decision_note'] = note ?? null;
  row['decided_at'] = now();
}

// ── readiness runs ──────────────────────────────────────────────────────────

function mapRun(r: Row): ReadinessRunRecord {
  return clone(r) as unknown as ReadinessRunRecord;
}

export async function createReadinessRun(input: {
  entityId: string;
  kind: ReadinessRunKind;
  parentRunId?: string | null;
  correctionsSinceParent?: number;
}): Promise<ReadinessRunRecord> {
  const started = now();
  const record: ReadinessRunRecord = {
    id: uid(),
    entity_id: input.entityId,
    kind: input.kind,
    status: 'running' as ReadinessStatus,
    score: 0,
    checks: [] as CheckResult[],
    blocking_issues: [] as BlockingIssue[],
    warnings: [],
    second_pass_answers: [],
    summary: null,
    ai_summary: null,
    corrections_since_parent: input.correctionsSinceParent ?? 0,
    parent_run_id: input.parentRunId ?? null,
    started_at: started,
    finished_at: null,
  };
  table('readiness_runs').push(record as unknown as Row);
  return mapRun(record as unknown as Row);
}

export async function finishReadinessRun(input: {
  runId: string;
  status: ReadinessStatus;
  score: number;
  checks: CheckResult[];
  blockingIssues: BlockingIssue[];
  warnings: ReadinessRunRecord['warnings'];
  secondPassAnswers?: ReadinessRunRecord['second_pass_answers'];
  summary: string;
  aiSummary?: string | null;
}): Promise<void> {
  const row = find<Row>('readiness_runs', (r) => r['id'] === input.runId);
  if (!row) throw new Error(`finishReadinessRun: run ${input.runId} does not exist`);
  row['status'] = input.status;
  row['score'] = input.score;
  row['checks'] = clone(input.checks);
  row['blocking_issues'] = clone(input.blockingIssues);
  row['warnings'] = clone(input.warnings);
  if (input.secondPassAnswers) row['second_pass_answers'] = clone(input.secondPassAnswers);
  row['summary'] = input.summary;
  row['ai_summary'] = input.aiSummary ?? null;
  row['finished_at'] = now();
}

export async function getReadinessRun(id: string): Promise<ReadinessRunRecord | null> {
  const r = find<Row>('readiness_runs', (x) => x['id'] === id);
  return r ? mapRun(r) : null;
}

export async function latestReadinessRun(entityId: string): Promise<ReadinessRunRecord | null> {
  const all = rows<ReadinessRunRecord>('readiness_runs').filter((r) => r.entity_id === entityId);
  return all.length ? mapRun(all.sort((a, b) => ASC(b.started_at) - ASC(a.started_at))[0] as unknown as Row) : null;
}

export async function latestCompletedRun(entityId: string): Promise<ReadinessRunRecord | null> {
  const done = rows<ReadinessRunRecord>('readiness_runs')
    .filter((r) => r.entity_id === entityId && r.finished_at)
    .sort((a, b) => ASC(b.started_at) - ASC(a.started_at));
  return done.length ? mapRun(done[0] as unknown as Row) : null;
}

export async function latestReadyRun(entityId: string): Promise<ReadinessRunRecord | null> {
  const ready = rows<ReadinessRunRecord>('readiness_runs')
    .filter((r) => r.entity_id === entityId && r.status === 'ready')
    .sort((a, b) => ASC(b.finished_at) - ASC(a.finished_at));
  return ready.length ? mapRun(ready[0] as unknown as Row) : null;
}

/**
 * Review decisions since a moment. `review_items` has no `updated_at`, and `'resolved'` is not one
 * of its statuses, so this counts real decisions recorded in `decided_at`.
 */
export async function countCorrectionsSince(entityId: string, since: string | null): Promise<number> {
  const decided = rows<ReviewItemRecord>('review_items').filter(
    (i) =>
      i.entity_id === entityId &&
      (i.status === 'accepted' || i.status === 'rejected' || i.status === 'applied') &&
      (since === null || ASC(i.decided_at) > new Date(since).getTime()),
  );
  return decided.length;
}

export async function listReadinessRuns(entityId: string, limit = 20): Promise<ReadinessRunRecord[]> {
  return rows<ReadinessRunRecord>('readiness_runs')
    .filter((r) => r.entity_id === entityId)
    .sort((a, b) => ASC(b.started_at) - ASC(a.started_at))
    .slice(0, limit);
}

// ── evidence minimum snapshots ──────────────────────────────────────────────

export async function saveEvidenceMinimums(input: {
  entityId: string;
  websitesSupplied: number;
  websitesQualifying: number;
  pressSupplied: number;
  pressQualifying: number;
  photosSupplied: number;
  photosQualifying: number;
  independentPressGroups: number;
  detail: Record<string, unknown>;
}): Promise<void> {
  table('evidence_minimums').push({
    id: uid(),
    entity_id: input.entityId,
    websites_supplied: input.websitesSupplied,
    websites_qualifying: input.websitesQualifying,
    press_supplied: input.pressSupplied,
    press_qualifying: input.pressQualifying,
    photos_supplied: input.photosSupplied,
    photos_qualifying: input.photosQualifying,
    independent_press_groups: input.independentPressGroups,
    detail: clone(input.detail),
    computed_at: now(),
  });
  // Keep the ten most recent snapshots per entity, matching the SQL's pruning.
  const mine = rows<EvidenceMinimumsRecord>('evidence_minimums')
    .filter((r) => r.entity_id === input.entityId)
    .sort((a, b) => ASC(b.computed_at) - ASC(a.computed_at));
  const keep = new Set(mine.slice(0, 10).map((r) => r.id));
  drop('evidence_minimums', (r) => r['entity_id'] === input.entityId && !keep.has(String(r['id'])));
}

export async function latestEvidenceMinimums(entityId: string): Promise<EvidenceMinimumsRecord | null> {
  const mine = rows<EvidenceMinimumsRecord>('evidence_minimums')
    .filter((r) => r.entity_id === entityId)
    .sort((a, b) => ASC(b.computed_at) - ASC(a.computed_at));
  return mine.length ? (clone(mine[0]) ?? null) : null;
}

export type { ReadinessCheckId };