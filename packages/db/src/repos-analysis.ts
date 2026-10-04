/** Claims, evidence, identity links, conflicts, ambiguities, review items, readiness runs. */

import type {
  AuthorityTier,
  CheckOutcome,
  ClaimOrigin,
  ClaimStatus,
  ConflictKind,
  Confidence,
  IdentityState,
  ReadinessCheckId,
  ReadinessRunKind,
  ReadinessStatus,
  ResolutionStatus,
  ReviewKind,
  ReviewStatus,
  Severity,
  SupportStrength,
} from '@nexora/core';
import { bool, json, num, query, queryOne } from './pool';

export interface ClaimRecord {
  id: string;
  entity_id: string;
  attribute_key: string;
  predicate: string;
  node_type: string | null;
  value_text: string;
  value_json: Record<string, unknown>;
  normalized_key: string | null;
  origin: ClaimOrigin;
  status: ClaimStatus;
  support_strength: SupportStrength;
  authority_tier: AuthorityTier;
  confidence: Confidence;
  source_id: string | null;
  independence_group: string | null;
  period_start: string | null;
  period_end: string | null;
  is_current: boolean | null;
  discovered_at: Date | null;
  verified_at: Date | null;
  last_checked_at: Date | null;
  conflicting: boolean;
  conflict_ids: string[];
  publish: boolean;
  user_confirmed: boolean;
  stage_key: string | null;
  display_label: string | null;
  sort_order: number;
  created_at: Date;
  updated_at: Date;
}

function mapClaim(r: Record<string, unknown>): ClaimRecord {
  return {
    ...(r as unknown as ClaimRecord),
    value_json: json(r.value_json, {} as Record<string, unknown>),
    confidence: num(r.confidence),
    authority_tier: num(r.authority_tier) as AuthorityTier,
    conflicting: bool(r.conflicting),
    conflict_ids: (r.conflict_ids as string[] | null) ?? [],
    publish: bool(r.publish),
    user_confirmed: bool(r.user_confirmed),
    sort_order: num(r.sort_order),
  };
}

export async function listClaims(entityId: string): Promise<ClaimRecord[]> {
  const rows = await query<Record<string, unknown>>(
    'SELECT * FROM claims WHERE entity_id = $1 ORDER BY attribute_key ASC, sort_order ASC, created_at ASC',
    [entityId],
  );
  return rows.map(mapClaim);
}

export async function listClaimsByAttribute(entityId: string, attributeKey: string): Promise<ClaimRecord[]> {
  const rows = await query<Record<string, unknown>>(
    'SELECT * FROM claims WHERE entity_id = $1 AND attribute_key = $2 ORDER BY created_at ASC',
    [entityId, attributeKey],
  );
  return rows.map(mapClaim);
}

export async function getClaim(id: string): Promise<ClaimRecord | null> {
  const row = await queryOne<Record<string, unknown>>('SELECT * FROM claims WHERE id = $1', [id]);
  return row ? mapClaim(row) : null;
}

export interface ClaimInsert {
  entityId: string;
  attributeKey: string;
  predicate: string;
  nodeType?: string | null;
  valueText: string;
  valueJson?: Record<string, unknown>;
  normalizedKey?: string | null;
  origin: ClaimOrigin;
  status: ClaimStatus;
  supportStrength?: SupportStrength;
  authorityTier?: AuthorityTier;
  confidence?: number;
  sourceId?: string | null;
  independenceGroup?: string | null;
  periodStart?: string | null;
  periodEnd?: string | null;
  isCurrent?: boolean | null;
  stageKey?: string | null;
  displayLabel?: string | null;
  sortOrder?: number;
  publish?: boolean;
  userConfirmed?: boolean;
  discovered?: boolean;
}

export async function upsertClaim(input: ClaimInsert): Promise<ClaimRecord> {
  const params: unknown[] = [
    input.entityId,
    input.attributeKey,
    input.predicate,
    input.nodeType ?? null,
    input.valueText,
    JSON.stringify(input.valueJson ?? {}),
    input.normalizedKey ?? null,
    input.origin,
    input.status,
    input.supportStrength ?? 'none',
    input.authorityTier ?? 1,
    input.confidence ?? 0,
    input.sourceId ?? null,
    input.independenceGroup ?? null,
    input.periodStart ?? null,
    input.periodEnd ?? null,
    input.isCurrent ?? null,
    input.stageKey ?? null,
    input.displayLabel ?? null,
    input.sortOrder ?? 0,
    input.publish ?? false,
    input.userConfirmed ?? false,
    input.discovered ?? false,
  ];

  const row = await queryOne<Record<string, unknown>>(
    `INSERT INTO claims (
       entity_id, attribute_key, predicate, node_type, value_text, value_json,
       normalized_key, origin, status, support_strength, authority_tier, confidence,
       source_id, independence_group, period_start, period_end, is_current,
       stage_key, display_label, sort_order, publish, user_confirmed, discovered_at
     )
     VALUES (
       $1, $2, $3, $4, $5, $6::jsonb, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17,
       $18, $19, $20, $21, $22,
       CASE WHEN $23 THEN now() ELSE NULL END
     )
     ON CONFLICT DO NOTHING
     RETURNING *`,
    params,
  );
  if (row) return mapClaim(row);

  // An identical value for this attribute already exists. Return the existing claim.
  const existing = await queryOne<Record<string, unknown>>(
    `SELECT * FROM claims
      WHERE entity_id = $1 AND attribute_key = $2 AND value_text = $3
        AND (source_id IS NOT DISTINCT FROM $4)
      ORDER BY created_at ASC LIMIT 1`,
    [input.entityId, input.attributeKey, input.valueText, input.sourceId ?? null],
  );
  if (!existing) throw new Error('upsertClaim could not resolve existing row');
  return mapClaim(existing);
}

export async function updateClaimStatus(
  claimId: string,
  input: {
    status?: ClaimStatus;
    supportStrength?: SupportStrength;
    confidence?: number;
    publish?: boolean;
    userConfirmed?: boolean;
    conflicting?: boolean;
    verified?: boolean;
  },
): Promise<void> {
  const sets: string[] = ['updated_at = now()'];
  const params: unknown[] = [claimId];
  const set = (col: string, value: unknown) => {
    params.push(value);
    sets.push(`${col} = $${params.length}`);
  };
  if (input.status !== undefined) set('status', input.status);
  if (input.supportStrength !== undefined) set('support_strength', input.supportStrength);
  if (input.confidence !== undefined) set('confidence', input.confidence);
  if (input.publish !== undefined) set('publish', input.publish);
  if (input.userConfirmed !== undefined) set('user_confirmed', input.userConfirmed);
  if (input.conflicting !== undefined) set('conflicting', input.conflicting);
  if (input.verified !== undefined) {
    params.push(input.verified);
    sets.push(`verified_at = CASE WHEN $${params.length} THEN now() ELSE verified_at END`);
  }
  if (sets.length === 1) return;
  await query(`UPDATE claims SET ${sets.join(', ')} WHERE id = $1`, params);
}

export async function attachClaimToConflicts(claimId: string, conflictIds: string[]): Promise<void> {
  await query('UPDATE claims SET conflict_ids = $2::uuid[], updated_at = now() WHERE id = $1', [
    claimId,
    conflictIds,
  ]);
}

export async function deleteClaim(claimId: string): Promise<void> {
  await query('DELETE FROM claims WHERE id = $1', [claimId]);
}

export async function deleteClaimsForStage(entityId: string, stageKey: string): Promise<number> {
  const rows = await query<{ id: string }>(
    `DELETE FROM claims WHERE entity_id = $1 AND stage_key = $2 AND origin = 'user' RETURNING id`,
    [entityId, stageKey],
  );
  return rows.length;
}

// ── Evidence ─────────────────────────────────────────────────────────────

export interface EvidenceRecord {
  id: string;
  entity_id: string;
  claim_id: string | null;
  source_id: string | null;
  kind: string;
  strength: number;
  independence_group: string | null;
  detail: string | null;
  payload: Record<string, unknown>;
  obtained_at: Date;
}

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
  const rows = await query<EvidenceRecord>(
    `INSERT INTO evidence (entity_id, claim_id, source_id, kind, strength, independence_group, detail, payload)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb) RETURNING *`,
    [
      input.entityId,
      input.claimId ?? null,
      input.sourceId ?? null,
      input.kind,
      input.strength,
      input.independenceGroup ?? null,
      input.detail ?? null,
      JSON.stringify(input.payload ?? {}),
    ],
  );
  const row = rows[0];
  if (!row) throw new Error('insertEvidence returned no row');
  return row;
}

export async function listEvidence(entityId: string): Promise<EvidenceRecord[]> {
  return query<EvidenceRecord>('SELECT * FROM evidence WHERE entity_id = $1 ORDER BY obtained_at ASC', [entityId]);
}

export async function listEvidenceForClaim(claimId: string): Promise<EvidenceRecord[]> {
  return query<EvidenceRecord>('SELECT * FROM evidence WHERE claim_id = $1 ORDER BY obtained_at ASC', [claimId]);
}

export async function deleteEvidenceForSource(sourceId: string): Promise<void> {
  await query('DELETE FROM evidence WHERE source_id = $1', [sourceId]);
}

// ── Identity links ───────────────────────────────────────────────────────

export interface IdentityLinkRecord {
  id: string;
  entity_id: string;
  source_id: string;
  platform: string | null;
  handle: string | null;
  resolved_state: IdentityState;
  score: number;
  signals: Record<string, unknown>;
  rationale: string | null;
  method: string;
  user_decision: 'accept' | 'reject' | null;
  evaluated_at: Date;
}

function mapIdentityLink(r: Record<string, unknown>): IdentityLinkRecord {
  return {
    ...(r as unknown as IdentityLinkRecord),
    signals: json(r.signals, {} as Record<string, unknown>),
    score: num(r.score),
    user_decision: (r.user_decision as 'accept' | 'reject' | null) ?? null,
  };
}

export async function listIdentityLinks(entityId: string): Promise<IdentityLinkRecord[]> {
  const rows = await query<Record<string, unknown>>(
    'SELECT * FROM identity_links WHERE entity_id = $1 ORDER BY score DESC',
    [entityId],
  );
  return rows.map(mapIdentityLink);
}

export async function upsertIdentityLink(input: {
  entityId: string;
  sourceId: string;
  platform?: string | null;
  handle?: string | null;
  state: IdentityState;
  score: number;
  signals: Record<string, unknown>;
  rationale: string;
  method: string;
}): Promise<IdentityLinkRecord> {
  const row = await queryOne<Record<string, unknown>>(
    `INSERT INTO identity_links (entity_id, source_id, platform, handle, resolved_state, score,
                                 signals, rationale, method, evaluated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8,$9, now())
     ON CONFLICT (entity_id, source_id) DO UPDATE
       SET platform = EXCLUDED.platform, handle = EXCLUDED.handle,
           resolved_state = EXCLUDED.resolved_state, score = EXCLUDED.score,
           signals = EXCLUDED.signals, rationale = EXCLUDED.rationale,
           method = EXCLUDED.method, evaluated_at = now()
     RETURNING *`,
    [
      input.entityId,
      input.sourceId,
      input.platform ?? null,
      input.handle ?? null,
      input.state,
      input.score,
      JSON.stringify(input.signals),
      input.rationale,
      input.method,
    ],
  );
  if (!row) throw new Error('upsertIdentityLink returned no row');
  return mapIdentityLink(row);
}

export async function setIdentityUserDecision(linkId: string, decision: 'accept' | 'reject'): Promise<void> {
  await query('UPDATE identity_links SET user_decision = $2, evaluated_at = now() WHERE id = $1', [
    linkId,
    decision,
  ]);
}

// ── Conflicts ────────────────────────────────────────────────────────────

export interface ConflictRecord {
  id: string;
  entity_id: string;
  attribute_key: string;
  kind: ConflictKind;
  severity: Severity;
  claim_ids: string[];
  source_ids: string[];
  description: string;
  user_message: string | null;
  evidence: Record<string, unknown>;
  status: ResolutionStatus;
  resolution_note: string | null;
  resolved_at: Date | null;
  detected_at: Date;
}

function mapConflict(r: Record<string, unknown>): ConflictRecord {
  return {
    ...(r as unknown as ConflictRecord),
    claim_ids: (r.claim_ids as string[] | null) ?? [],
    source_ids: (r.source_ids as string[] | null) ?? [],
    evidence: json(r.evidence, {} as Record<string, unknown>),
  };
}

export async function listConflicts(entityId: string, openOnly = false): Promise<ConflictRecord[]> {
  const rows = await query<Record<string, unknown>>(
    `SELECT * FROM conflicts WHERE entity_id = $1 ${openOnly ? "AND status = 'open'" : ''}
      ORDER BY (severity = 'blocking') DESC, detected_at DESC`,
    [entityId],
  );
  return rows.map(mapConflict);
}

export async function getConflict(id: string): Promise<ConflictRecord | null> {
  const row = await queryOne<Record<string, unknown>>('SELECT * FROM conflicts WHERE id = $1', [id]);
  return row ? mapConflict(row) : null;
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
  const row = await queryOne<Record<string, unknown>>(
    `INSERT INTO conflicts (entity_id, attribute_key, kind, severity, claim_ids, source_ids,
                            description, user_message, evidence)
     VALUES ($1,$2,$3,$4,$5::uuid[],$6::uuid[],$7,$8,$9::jsonb)
     RETURNING *`,
    [
      input.entityId,
      input.attributeKey,
      input.kind,
      input.severity,
      input.claimIds ?? [],
      input.sourceIds ?? [],
      input.description,
      input.userMessage ?? null,
      JSON.stringify(input.evidence ?? {}),
    ],
  );
  if (!row) throw new Error('insertConflict returned no row');
  return mapConflict(row);
}

export async function resolveConflict(
  conflictId: string,
  status: ResolutionStatus,
  note?: string | null,
): Promise<void> {
  await query(
    `UPDATE conflicts SET status = $2, resolution_note = COALESCE($3, resolution_note),
            resolved_at = now() WHERE id = $1`,
    [conflictId, status, note ?? null],
  );
}

export async function reopenConflictsForAttribute(entityId: string, attributeKey: string): Promise<void> {
  await query(
    `UPDATE conflicts SET status = 'open', resolved_at = NULL
      WHERE entity_id = $1 AND attribute_key = $2 AND status IN ('resolved_by_user','dismissed')`,
    [entityId, attributeKey],
  );
}

// ── Ambiguities ──────────────────────────────────────────────────────────

export interface AmbiguityRecord {
  id: string;
  entity_id: string;
  dimension: string;
  description: string;
  candidates: unknown[];
  missing_evidence: unknown[];
  severity: Severity;
  status: 'open' | 'resolved' | 'dismissed';
  resolution_note: string | null;
  resolved_at: Date | null;
  detected_at: Date;
}

function mapAmbiguity(r: Record<string, unknown>): AmbiguityRecord {
  return {
    ...(r as unknown as AmbiguityRecord),
    candidates: json(r.candidates, [] as unknown[]),
    missing_evidence: json(r.missing_evidence, [] as unknown[]),
  };
}

export async function listAmbiguities(entityId: string, openOnly = false): Promise<AmbiguityRecord[]> {
  const rows = await query<Record<string, unknown>>(
    `SELECT * FROM ambiguities WHERE entity_id = $1 ${openOnly ? "AND status = 'open'" : ''}
      ORDER BY (severity = 'blocking') DESC, detected_at DESC`,
    [entityId],
  );
  return rows.map(mapAmbiguity);
}

export async function insertAmbiguity(input: {
  entityId: string;
  dimension: string;
  description: string;
  candidates?: unknown[];
  missingEvidence?: unknown[];
  severity: Severity;
}): Promise<AmbiguityRecord> {
  const row = await queryOne<Record<string, unknown>>(
    `INSERT INTO ambiguities (entity_id, dimension, description, candidates, missing_evidence, severity)
     VALUES ($1,$2,$3,$4::jsonb,$5::jsonb,$6) RETURNING *`,
    [
      input.entityId,
      input.dimension,
      input.description,
      JSON.stringify(input.candidates ?? []),
      JSON.stringify(input.missingEvidence ?? []),
      input.severity,
    ],
  );
  if (!row) throw new Error('insertAmbiguity returned no row');
  return mapAmbiguity(row);
}

export async function resolveAmbiguity(
  ambiguityId: string,
  status: 'resolved' | 'dismissed',
  note?: string | null,
): Promise<void> {
  await query(
    'UPDATE ambiguities SET status = $2, resolution_note = COALESCE($3, resolution_note), resolved_at = now() WHERE id = $1',
    [ambiguityId, status, note ?? null],
  );
}

// ── Review queue ─────────────────────────────────────────────────────────

export interface ReviewItemRecord {
  id: string;
  entity_id: string;
  kind: ReviewKind;
  title: string;
  detail: string | null;
  proposed: Record<string, unknown>;
  source_id: string | null;
  claim_id: string | null;
  conflict_id: string | null;
  ambiguity_id: string | null;
  stage_key: string | null;
  blocking: boolean;
  status: ReviewStatus;
  decision_note: string | null;
  created_at: Date;
  decided_at: Date | null;
}

function mapReviewItem(r: Record<string, unknown>): ReviewItemRecord {
  return {
    ...(r as unknown as ReviewItemRecord),
    proposed: json(r.proposed, {} as Record<string, unknown>),
    blocking: bool(r.blocking),
  };
}

export async function listReviewItems(entityId: string, pendingOnly = false): Promise<ReviewItemRecord[]> {
  const rows = await query<Record<string, unknown>>(
    `SELECT * FROM review_items WHERE entity_id = $1 ${pendingOnly ? "AND status = 'pending'" : ''}
      ORDER BY blocking DESC, created_at ASC`,
    [entityId],
  );
  return rows.map(mapReviewItem);
}

export async function countPendingReviewItems(entityId: string): Promise<number> {
  const row = await queryOne<{ n: number }>(
    "SELECT count(*)::int AS n FROM review_items WHERE entity_id = $1 AND status = 'pending'",
    [entityId],
  );
  return num(row?.n);
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
  const row = await queryOne<Record<string, unknown>>(
    `INSERT INTO review_items (entity_id, kind, title, detail, proposed, source_id, claim_id,
                               conflict_id, ambiguity_id, stage_key, blocking)
     VALUES ($1,$2,$3,$4,$5::jsonb,$6,$7,$8,$9,$10,$11)
     ON CONFLICT DO NOTHING
     RETURNING *`,
    [
      input.entityId,
      input.kind,
      input.title,
      input.detail ?? null,
      JSON.stringify(input.proposed ?? {}),
      input.sourceId ?? null,
      input.claimId ?? null,
      input.conflictId ?? null,
      input.ambiguityId ?? null,
      input.stageKey ?? null,
      input.blocking ?? false,
    ],
  );
  if (row) return mapReviewItem(row);
  // Conflict path: a review item for this conflict already exists. Return it.
  const existing = (await listReviewItems(input.entityId, false)).find((i) => i.conflict_id === input.conflictId);
  if (existing) return existing;
  throw new Error('insertReviewItem could not resolve existing row');
}

export async function getReviewItem(id: string): Promise<ReviewItemRecord | null> {
  const row = await queryOne<Record<string, unknown>>('SELECT * FROM review_items WHERE id = $1', [id]);
  return row ? mapReviewItem(row) : null;
}

export async function decideReviewItem(
  id: string,
  status: ReviewStatus,
  note?: string | null,
): Promise<void> {
  await query(
    'UPDATE review_items SET status = $2, decision_note = $3, decided_at = now() WHERE id = $1',
    [id, status, note ?? null],
  );
}

// ── Readiness runs ───────────────────────────────────────────────────────

export interface CheckResult {
  id: ReadinessCheckId;
  label: string;
  outcome: CheckOutcome;
  weight: number;
  detail: string;
  sourceRefs: { id: string; label: string; url?: string | null }[];
  stageKey?: string | null;
  blocking: boolean;
  data?: Record<string, unknown>;
}

export interface BlockingIssue {
  code: string;
  title: string;
  detail: string;
  where: { sourceId?: string | null; sourceLabel?: string | null; sourceUrl?: string | null; stageKey?: string | null };
  action: string;
  actionHref?: string;
  checkId: ReadinessCheckId;
}

export interface ReadinessRunRecord {
  id: string;
  entity_id: string;
  kind: ReadinessRunKind;
  status: ReadinessStatus;
  score: number;
  checks: CheckResult[];
  blocking_issues: BlockingIssue[];
  warnings: { code: string; title: string; detail: string }[];
  second_pass_answers: { question: string; answer: string; pass: boolean; detail: string }[];
  summary: string | null;
  ai_summary: string | null;
  corrections_since_parent: number;
  parent_run_id: string | null;
  started_at: Date;
  finished_at: Date | null;
}

function mapRun(r: Record<string, unknown>): ReadinessRunRecord {
  return {
    ...(r as unknown as ReadinessRunRecord),
    checks: json(r.checks, [] as CheckResult[]),
    blocking_issues: json(r.blocking_issues, [] as BlockingIssue[]),
    warnings: json(r.warnings, [] as ReadinessRunRecord['warnings']),
    second_pass_answers: json(r.second_pass_answers, [] as ReadinessRunRecord['second_pass_answers']),
    score: num(r.score),
    corrections_since_parent: num(r.corrections_since_parent),
  };
}

export async function createReadinessRun(input: {
  entityId: string;
  kind: ReadinessRunKind;
  parentRunId?: string | null;
  correctionsSinceParent?: number;
}): Promise<ReadinessRunRecord> {
  const row = await queryOne<Record<string, unknown>>(
    `INSERT INTO readiness_runs (entity_id, kind, parent_run_id, corrections_since_parent)
     VALUES ($1,$2,$3,$4) RETURNING *`,
    [input.entityId, input.kind, input.parentRunId ?? null, input.correctionsSinceParent ?? 0],
  );
  if (!row) throw new Error('createReadinessRun returned no row');
  return mapRun(row);
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
  await query(
    `UPDATE readiness_runs
        SET status = $2, score = $3, checks = $4::jsonb, blocking_issues = $5::jsonb,
            warnings = $6::jsonb, second_pass_answers = COALESCE($7::jsonb, second_pass_answers),
            summary = $8, ai_summary = $9, finished_at = now()
      WHERE id = $1`,
    [
      input.runId,
      input.status,
      input.score,
      JSON.stringify(input.checks),
      JSON.stringify(input.blockingIssues),
      JSON.stringify(input.warnings),
      input.secondPassAnswers ? JSON.stringify(input.secondPassAnswers) : null,
      input.summary,
      input.aiSummary ?? null,
    ],
  );
}

export async function getReadinessRun(id: string): Promise<ReadinessRunRecord | null> {
  const row = await queryOne<Record<string, unknown>>('SELECT * FROM readiness_runs WHERE id = $1', [id]);
  return row ? mapRun(row) : null;
}

export async function latestReadinessRun(entityId: string): Promise<ReadinessRunRecord | null> {
  const row = await queryOne<Record<string, unknown>>(
    'SELECT * FROM readiness_runs WHERE entity_id = $1 ORDER BY started_at DESC LIMIT 1',
    [entityId],
  );
  return row ? mapRun(row) : null;
}

export async function latestCompletedRun(entityId: string): Promise<ReadinessRunRecord | null> {
  const row = await queryOne<Record<string, unknown>>(
    `SELECT * FROM readiness_runs WHERE entity_id = $1 AND finished_at IS NOT NULL
      ORDER BY started_at DESC LIMIT 1`,
    [entityId],
  );
  return row ? mapRun(row) : null;
}

export async function latestReadyRun(entityId: string): Promise<ReadinessRunRecord | null> {
  const row = await queryOne<Record<string, unknown>>(
    `SELECT * FROM readiness_runs WHERE entity_id = $1 AND status = 'ready'
      ORDER BY finished_at DESC LIMIT 1`,
    [entityId],
  );
  return row ? mapRun(row) : null;
}

/**
 * Count review items resolved since a given moment.
 *
 * The second pass reports how much changed since its parent run. Reporting zero would understate
 * the review, so the count is derived from real resolutions rather than assumed.
 */
export async function countCorrectionsSince(entityId: string, since: string | null): Promise<number> {
  const row = await queryOne<{ n: number }>(
    since
      ? `SELECT count(*)::int AS n FROM review_items
         WHERE entity_id = $1 AND status = 'resolved' AND updated_at > $2`
      : `SELECT count(*)::int AS n FROM review_items WHERE entity_id = $1 AND status = 'resolved'`,
    since ? [entityId, since] : [entityId],
  );
  return num(row?.n);
}

export async function listReadinessRuns(entityId: string, limit = 20): Promise<ReadinessRunRecord[]> {
  const rows = await query<Record<string, unknown>>(
    'SELECT * FROM readiness_runs WHERE entity_id = $1 ORDER BY started_at DESC LIMIT $2',
    [entityId, limit],
  );
  return rows.map(mapRun);
}

// ── Evidence minimum snapshots ───────────────────────────────────────────

export interface EvidenceMinimumsRecord {
  id: string;
  entity_id: string;
  websites_supplied: number;
  websites_qualifying: number;
  press_supplied: number;
  press_qualifying: number;
  photos_supplied: number;
  photos_qualifying: number;
  independent_press_groups: number;
  detail: Record<string, unknown>;
  computed_at: Date;
}

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
  await query(
    `INSERT INTO evidence_minimums (entity_id, websites_supplied, websites_qualifying,
        press_supplied, press_qualifying, photos_supplied, photos_qualifying,
        independent_press_groups, detail)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb)`,
    [
      input.entityId,
      input.websitesSupplied,
      input.websitesQualifying,
      input.pressSupplied,
      input.pressQualifying,
      input.photosSupplied,
      input.photosQualifying,
      input.independentPressGroups,
      JSON.stringify(input.detail),
    ],
  );
  await query(
    `DELETE FROM evidence_minimums WHERE entity_id = $1 AND id NOT IN
       (SELECT id FROM evidence_minimums WHERE entity_id = $1 ORDER BY computed_at DESC LIMIT 10)`,
    [input.entityId],
  );
}

export async function latestEvidenceMinimums(entityId: string): Promise<EvidenceMinimumsRecord | null> {
  const row = await queryOne<Record<string, unknown>>(
    'SELECT * FROM evidence_minimums WHERE entity_id = $1 ORDER BY computed_at DESC LIMIT 1',
    [entityId],
  );
  if (!row) return null;
  return {
    ...(row as unknown as EvidenceMinimumsRecord),
    websites_supplied: num(row.websites_supplied),
    websites_qualifying: num(row.websites_qualifying),
    press_supplied: num(row.press_supplied),
    press_qualifying: num(row.press_qualifying),
    photos_supplied: num(row.photos_supplied),
    photos_qualifying: num(row.photos_qualifying),
    independent_press_groups: num(row.independent_press_groups),
    detail: json(row.detail, {} as Record<string, unknown>),
  };
}