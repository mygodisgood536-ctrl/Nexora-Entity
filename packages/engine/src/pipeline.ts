/**
 * The complete analysis pipeline.
 *
 * ingest → inspect → identity resolution → provenance/evidence → conflicts → ambiguity →
 * completeness → readiness → review queue → (optional, advisory) AI
 *
 * Runs automatically in the background. Every step is idempotent and re-runnable. If the AI
 * provider fails at any point, all deterministic work is still committed and the failure is
 * recorded as a provider failure — never as a problem with the person's data.
 */

import {
  ALL_EVIDENCE_MINIMUMS,
  ClaimOrigin,
  ClaimStatus,
  IdentityState,
  ReadinessCheckId,
  ReviewKind,
  Severity,
  SourceType,
  SupportStrength,
  canonicalizeUrl,
  createLogger,
  registrableDomain,
  type StageKey,
} from '@nexora/core';
import {
  audit,
  countPendingReviewItems,
  deleteClaimsForStage,
  findEntityById,
  upsertClaim,
  insertConflict,
  insertEvidence,
  insertAmbiguity,
  insertReviewItem,
  insertSource,
  latestEvidenceMinimums,
  listAmbiguities,
  listClaims,
  listConflicts,
  listIdentityLinks,
  listPhotos,
  listPortfolioFiles,
  listReviewItems,
  listSources,
  listStageProgress,
  countQualifyingPhotos,
  countQualifyingPress,
  countQualifyingWebsites,
  listEvidence,
  query,
  resolveAmbiguity,
  resolveConflict,
  saveEvidenceMinimums,
  setSourceDuplicate,
  setSourcePublished,
  upsertIdentityLink,
  updateClaimStatus,
  updateSourceInspection,
  markSourceInspecting,
  type ClaimRecord,
  type SourceRecord,
} from '@nexora/db';
import {
  assessDuplicate,
  classifySourceType,
  inspectUrl,
  qualifySource,
  roleFlags,
  type SubjectProfile,
} from '@nexora/inspect';
import type { InspectionResult } from '@nexora/inspect';
import { claimsFromStage, urlsFromStage } from './ingest';
import { applyProvenance, type ProvenanceOutcome } from './provenance';
import { resolveIdentity } from './identity';
import { detectConflicts, detectLogicalContradictions } from './conflicts';
import { runAmbiguityDetection } from './ambiguity';
import { evaluateReadiness, type ReadinessReport } from './readiness';
import { buildEntityGraph } from './graph';
import { structuredDataFor } from './structured-data';
import { discoverCandidatesFromSource, suggestAliases, assessAmbiguity, narrateReadiness } from './ai';
import { resolveAccountModel, safeAi, type AiFailure, type AiFailureCollector } from './ai-runtime';
import type { ModelRef } from '@nexora/opencode-bridge';

const log = createLogger('engine:pipeline');

/**
 * Candidate kinds that describe a *relationship* to the person rather than a fact about them.
 * They are queued for review as relationships so the review queue reads correctly.
 */
const RELATIONSHIP_CANDIDATE_TYPES = new Set(['organisation', 'project', 'product', 'alias']);

export interface PipelineOptions {
  /** Re-inspect every source, even ones already inspected. */
  forceReinspect?: boolean;
  /** Run AI-assisted discovery. Requires a verified provider/model. */
  useAi?: boolean;
  model?: { providerId: string; providerName: string; modelId: string; modelName: string } | null;
  /** Only process these stages (used after a single stage save). */
  stageKeys?: StageKey[];
  /** Called with progress messages for the live interface. */
  onProgress?: (message: string, percent: number) => void;
}

export interface PipelineResult {
  entityId: string;
  sourcesInspected: number;
  sourcesUnreadable: number;
  identitiesResolved: number;
  conflictsOpen: number;
  ambiguitiesOpen: number;
  evidenceMinimums: {
    websites: { supplied: number; qualifying: number; required: number; met: boolean };
    pressReleases: { supplied: number; qualifying: number; required: number; met: boolean; independentGroups: number };
    photos: { supplied: number; qualifying: number; required: number; met: boolean };
  };
  graph: { nodes: number; edges: number };
  pendingReview: number;
  provenance: ProvenanceOutcome;
  readiness: ReadinessReport;
  aiFailures: { operation: string; message: string }[];
  durationMs: number;
}

export function buildSubjectProfile(claims: ClaimRecord[], sources: SourceRecord[]): SubjectProfile {
  const value = (key: string): string[] =>
    claims.filter((c) => c.attribute_key === key && c.status !== 'rejected').map((c) => c.value_text.trim()).filter(Boolean);
  const declared = (stageKey: StageKey): string[] => {
    const out: string[] = [];
    for (const c of claims) {
      if (c.stage_key !== stageKey) continue;
      const url = c.value_json['url'];
      if (typeof url === 'string') out.push(url);
    }
    return out;
  };

  const names = [...value('identity.primaryName'), ...value('identity.fullPublicName'), ...value('identity.firstName').map((f) => {
    const last = value('identity.lastName')[0] ?? '';
    return last ? `${f} ${last}` : f;
  })].filter(Boolean);
  const aliases = value('identity.alias');
  const professions = [...value('professional.profession'), ...value('professional.title'), ...value('about.expertiseSummary')];
  const organizations = [...claims.filter((c) => c.attribute_key.startsWith('organizations.')).map((c) => c.value_text), ...value('professional.currentCompany')];
  const projects = [...value('projects.project'), ...value('products.product'), ...value('products.service')];
  const locations = [...value('identity.location'), ...claims.filter((c) => c.attribute_key.startsWith('location.')).map((c) => c.value_text)];
  const biography = value('about.biography')[0] ?? null;
  const handle = value('identity.handle')[0] ?? null;

  const ownedDomains = [
    ...declared('N_websites'),
    ...declared('V_external_identity_links'),
    ...sources.filter((s) => s.supplied_kind === 'personal_site').map((s) => s.url),
  ]
    .map((u) => registrableDomain(u))
    .filter((d): d is string => !!d);

  return {
    names: [...new Set(names)],
    aliases: [...new Set(aliases)],
    professions: [...new Set(professions)],
    organizations: [...new Set(organizations)],
    projects: [...new Set(projects)],
    handle: handle ?? null,
    ownedDomains: [...new Set(ownedDomains)],
    biography: biography ?? null,
    locations: [...new Set(locations)],
  };
}

/** Step 1 — turn saved stage data into provenance-bearing claims. */
export async function ingestStages(entityId: string, stageKeys?: StageKey[]): Promise<number> {
  const stages = await listStageProgress(entityId);
  let total = 0;
  for (const stage of stages) {
    if (stageKeys && !stageKeys.includes(stage.stage_key)) continue;
    if (stage.status === 'pending' || stage.status === 'skipped') {
      // A skipped stage is not a satisfied stage: clear any stale user claims from it.
      await deleteClaimsForStage(entityId, stage.stage_key);
      continue;
    }
    await deleteClaimsForStage(entityId, stage.stage_key);
    const claims = claimsFromStage(stage.stage_key, stage.data ?? {});
    for (const c of claims) {
      await upsertClaim({ ...c, entityId });
      total += 1;
    }
  }
  log.info('stages ingested', { entityId, claimCount: total });
  return total;
}

/** Step 2 — inspect every supplied URL and record the honest result. */
export async function inspectSources(
  entityId: string,
  subject: SubjectProfile,
  options: {
    force?: boolean;
    onProgress?: (m: string, p: number) => void;
    /** The account's verified provider/model, when AI assistance is switched on. */
    model?: ModelRef | null;
    /** Where AI failures are collected. An AI failure is never thrown. */
    failures?: AiFailureCollector;
  } = {},
): Promise<{ inspected: number; unreadable: number }> {
  const stages = await listStageProgress(entityId);
  const wanted: { url: string; suppliedKind: string }[] = [];
  for (const stage of stages) {
    wanted.push(...urlsFromStage(stage.stage_key, stage.data ?? {}));
  }

  const existing = await listSources(entityId);
  const existingByUrl = new Map(existing.map((s) => [s.canonical_url, s]));
  let inspected = 0;
  let unreadable = 0;

  for (let i = 0; i < wanted.length; i += 1) {
    const { url, suppliedKind } = wanted[i]!;
    options.onProgress?.(`Reading ${new URL(url).hostname} (${i + 1} of ${wanted.length})`, Math.round((i / Math.max(1, wanted.length)) * 40));

    const canon = canonicalizeUrl(url);
    if (!canon.ok) {
      const rec = await insertSource({
        entityId,
        url,
        canonicalUrl: url,
        registrableDomain: null,
        host: null,
        suppliedKind,
        sourceType: SourceType.other,
      });
      await updateSourceInspection({
        sourceId: rec.id,
        accessStatus: 'invalid_url',
        accessDetail: `This address is not usable: ${canon.reason}.`,
        inspectionStatus: 'failed',
        checkError: canon.reason,
      });
      unreadable += 1;
      continue;
    }

    const prior = existingByUrl.get(canon.canonical);
    if (prior && prior.inspection_status === 'inspected' && !options.force) {
      continue;
    }

    const rec = prior ?? (await insertSource({
      entityId,
      url,
      canonicalUrl: canon.canonical,
      registrableDomain: registrableDomain(canon.canonical),
      host: canon.url.hostname,
      suppliedKind,
      sourceType: SourceType.other,
    }));
    await markSourceInspecting(rec.id);

    const result = await inspectUrl(canon.canonical);
    const sourceType = classifySourceType({ inspection: result, declaredKind: suppliedKind });
    const role = roleFlags(suppliedKind);
    const qualification = qualifySource({
      url: canon.canonical,
      inspection: result,
      sourceType,
      declaredKind: suppliedKind,
      subject,
      declaredAsWebsite: role.website,
      declaredAsPress: role.press,
    });

    await updateSourceInspection({
      sourceId: rec.id,
      httpStatus: result.httpStatus,
      finalUrl: result.finalUrl,
      redirects: result.redirects,
      contentType: result.contentType,
      title: result.title,
      description: result.description,
      author: result.author,
      publishedDate: result.publishedDate,
      accessStatus: result.accessStatus,
      accessDetail: result.accessDetail,
      inspectionStatus: result.inspected ? 'inspected' : result.accessStatus === 'pending' ? 'pending' : 'failed',
      checkError: result.checkError,
      contentHash: result.contentHash,
      textExcerpt: result.textExcerpt,
      textLength: result.textLength,
      extracted: {
        names: result.extracted.names,
        alternateNames: result.extracted.alternateNames,
        isArticle: result.extracted.isArticle,
        articlePublisher: result.extracted.articlePublisher,
        loginWall: result.extracted.loginWall,
        challengePage: result.extracted.challengePage,
        headings: result.extracted.headings,
        emails: result.extracted.emails,
        platformDataUnavailable: result.extracted.platformDataUnavailable,
        headline: result.extracted.headline,
        organisation: result.extracted.organisation,
        location: result.extracted.location,
        description: result.extracted.description,
        images: result.extracted.images.map((img) => ({
          url: img.url,
          alt: img.alt ?? null,
          width: img.width ?? null,
          height: img.height ?? null,
        })),
        links: result.extracted.profileLinks.map((href) => ({ href })),
        sameAs: result.extracted.sameAs,
        jsonLdTypes: result.extracted.jsonLdTypes,
        platformData: result.platformData?.facts ?? null,
        excerpt: result.textExcerpt,
      },
      sourceType,
      platform: result.platform,
      platformHandle: result.platformHandle,
      independenceGroup: qualification.independenceGroup,
      qualifiers: {
        reachable: result.accessStatus === 'accessible',
        aboutSubject: qualification.subjectRelevance >= 0.55,
        liveContent: result.textLength >= 250,
        distinctContent: true,
        qualifiesWebsites: qualification.qualifiesWebsites,
        qualifiesPress: qualification.qualifiesPress,
        independence: qualification.independenceGroup,
        reasons: qualification.reasons,
        blockers: qualification.blockers,
        checkedAt: new Date().toISOString(),
        assessment: qualification.assessment,
        platformNote: result.platformNote,
      },
      qualifiesWebsites: qualification.qualifiesWebsites,
      qualifiesPress: qualification.qualifiesPress,
      subjectRelevance: qualification.subjectRelevance,
      qualityScore: qualification.qualityScore,
      inspected: result.inspected,
    });

    if (result.inspected) inspected += 1;
    else unreadable += 1;

    // Record the platform limitation honestly as a review item when it matters.
    if (result.platform && result.accessStatus !== 'accessible') {
      await insertReviewItem({
        entityId,
        kind: 'source_limit',
        title: `Could not read ${result.title ?? new URL(canon.canonical).hostname}`,
        detail: result.accessDetail ?? result.platformNote,
        proposed: { url: canon.canonical, platform: result.platform, accessStatus: result.accessStatus },
        sourceId: rec.id,
        stageKey: 'P_social_profiles',
        blocking: false,
      });
    }

    // AI-assisted discovery. Anything the model proposes is a *review item*, never a fact
    // (section 23): the person decides whether it is true, and until they do it is neither
    // published nor counted as evidence. A provider failure is collected, not thrown.
    if (options.model && result.inspected) {
      const failures = (options.failures ??= []);
      const candidates = await safeAi(failures, 'source_discovery', () =>
        discoverCandidatesFromSource({
          model: options.model as ModelRef,
          subject: {
            names: subject.names,
            aliases: subject.aliases,
            professions: subject.professions,
            organizations: subject.organizations,
          },
          source: { url: canon.canonical, title: result.title ?? null, textExcerpt: result.textExcerpt ?? null },
          inspection: result,
        }),
      );
      for (const candidate of candidates ?? []) {
        await insertReviewItem({
          entityId,
          kind: RELATIONSHIP_CANDIDATE_TYPES.has(candidate.type) ? 'discovered_relationship' : 'discovered_fact',
          title: candidate.value,
          detail: candidate.evidenceQuote || candidate.note || null,
          proposed: {
            type: candidate.type,
            value: candidate.value,
            confidence: candidate.confidence,
            evidenceQuote: candidate.evidenceQuote,
            sourceUrl: candidate.sourceUrl,
            note: candidate.note,
          },
          sourceId: rec.id,
          stageKey: 'P_social_profiles',
          // Advisory: a discovered item is never allowed to block publication on its own, but it
          // is never published without the person's agreement either.
          blocking: false,
        });
      }
    }
  }

  log.info('sources inspected', { entityId, inspected, unreadable });
  return { inspected, unreadable };
}

/** Step 3 — duplicate / independence detection across all sources. */
export async function resolveDuplication(entityId: string): Promise<number> {
  const sources = await listSources(entityId);
  const byRelevance = [...sources].sort((a, b) => b.subject_relevance - a.subject_relevance);
  let duplicates = 0;
  const others = sources
    .filter((s) => s.inspection_status === 'inspected')
    .map((s) => ({
      id: s.id,
      url: s.canonical_url,
      textExcerpt: s.text_excerpt,
      independenceGroup: s.independence_group ?? '',
      title: s.title,
    }));

  for (const s of byRelevance) {
    if (s.inspection_status !== 'inspected') continue;
    const assessment = assessDuplicate(
      { id: s.id, url: s.canonical_url, inspection: inspectionFromSource(s), independenceGroup: s.independence_group ?? '' },
      others.filter((o) => o.id !== s.id),
    );
    await setSourceDuplicate(s.id, assessment.duplicateOfId);
    if (assessment.duplicateOfId) {
      duplicates += 1;
      // A duplicate never counts toward a minimum, regardless of its own flags.
      await updateSourceInspection({
        sourceId: s.id,
        qualifiers: {
          reachable: true,
          aboutSubject: true,
          liveContent: true,
          distinctContent: false,
          qualifiesWebsites: false,
          qualifiesPress: false,
          independence: s.independence_group,
          reasons: [assessment.reason],
          blockers: [assessment.reason],
          checkedAt: new Date().toISOString(),
          assessment: 'Not counted: this duplicates another source.',
        },
        qualifiesWebsites: false,
        qualifiesPress: false,
      });
    }
  }
  log.info('duplication resolved', { entityId, duplicates });
  return duplicates;
}

/** Step 4 — identity resolution for every inspected source. */
export async function resolveIdentities(
  entityId: string,
  subject: SubjectProfile,
  options: { model?: ModelRef | null; failures?: AiFailureCollector } = {},
): Promise<number> {
  const sources = await listSources(entityId);
  const prior = new Map((await listIdentityLinks(entityId)).map((l) => [l.source_id, l]));
  let resolved = 0;

  for (const s of sources) {
    const pseudo = inspectionFromSource(s);
    const res = resolveIdentity({
      subject,
      inspection: pseudo,
      sourceUrl: s.canonical_url,
      sourceType: (s.source_type as SourceType) ?? SourceType.other,
      userDecision: prior.get(s.id)?.user_decision ?? null,
    });
    await upsertIdentityLink({
      entityId,
      sourceId: s.id,
      platform: s.platform,
      handle: s.platform_handle,
      state: res.state,
      score: res.score,
      signals: res.signals as unknown as Record<string, unknown>,
      rationale: res.rationale,
      method: res.method,
    });

    await insertEvidence({
      entityId,
      sourceId: s.id,
      kind: res.state === IdentityState.confirmed ? 'corroboration' : 'source_assertion',
      strength: res.score,
      independenceGroup: s.independence_group,
      detail: res.rationale,
      payload: { signals: res.signals, missingEvidence: res.missingEvidence, state: res.state },
    });

    if (res.state === IdentityState.probableNeedsReview || res.state === IdentityState.uncertain) {
      await insertReviewItem({
        entityId,
        kind: 'identity_verdict',
        title: `Is this profile yours? — ${s.title ?? s.canonical_url}`,
        detail: `${res.rationale}\n\nWhat would resolve it: ${res.missingEvidence.join(' ') || 'confirmation from you.'}`,
        proposed: {
          url: s.canonical_url,
          state: res.state,
          score: res.score,
          missingEvidence: res.missingEvidence,
        },
        sourceId: s.id,
        stageKey: 'P_social_profiles',
        blocking: false,
      });
    }
    if (res.state === IdentityState.conflict) {
      await insertReviewItem({
        entityId,
        kind: 'identity_verdict',
        title: `This source may belong to someone else — ${s.title ?? s.canonical_url}`,
        detail: `${res.rationale}`,
        proposed: { url: s.canonical_url, state: res.state, score: res.score },
        sourceId: s.id,
        stageKey: 'P_social_profiles',
        blocking: false,
      });
    }
    resolved += 1;
  }

  // AI-assisted alias reasoning. A name variant is never applied automatically: it is offered to
  // the person as a review item, because only they can say whether a name is theirs
  // (section 10, section 23).
  if (options.model) {
    const failures = (options.failures ??= []);
    const observed = sources
      .flatMap((s) => {
        const names = s.extracted?.['names'];
        return Array.isArray(names) ? names.map((n) => ({ name: String(n), sourceUrl: s.canonical_url })) : [];
      })
      .filter((n) => n.name.trim().length > 0);
    const suggestions = await safeAi(failures, 'alias_suggestion', () =>
      suggestAliases({
        model: options.model as ModelRef,
        entityName: subject.names[0] ?? '',
        knownNames: [...subject.names, ...subject.aliases],
        observedNames: observed,
      }),
    );
    for (const suggestion of suggestions ?? []) {
      await insertReviewItem({
        entityId,
        kind: 'discovered_relationship',
        title: `Possible name variant: ${suggestion.value}`,
        detail: suggestion.why || null,
        proposed: { type: 'alias', value: suggestion.value, why: suggestion.why },
        stageKey: 'B_name_variants',
        blocking: false,
      });
    }
  }

  log.info('identities resolved', { entityId, resolved });
  return resolved;
}

/**
 * Rebuild a complete InspectionResult from persisted state, so downstream engines can run
 * against stored sources without re-fetching. Every field is filled from what was actually
 * recorded at inspection time — nothing is invented.
 */
function inspectionFromSource(s: SourceRecord): InspectionResult {
  const e = s.extracted ?? {};
  return {
    url: s.url,
    finalUrl: s.final_url ?? s.canonical_url,
    httpStatus: s.http_status,
    redirects: s.redirects ?? [],
    contentType: s.content_type,
    accessStatus: s.access_status,
    accessDetail: s.access_detail,
    inspected: s.inspection_status === 'inspected',
    checkError: s.check_error,
    title: s.title,
    description: s.description,
    author: s.author,
    publishedDate: s.published_date,
    modifiedDate: null,
    textExcerpt: s.text_excerpt,
    textLength: s.text_length ?? 0,
    contentHash: s.content_hash,
    extracted: {
      names: e.names ?? [],
      alternateNames: e.alternateNames ?? [],
      headline: e.headline ?? null,
      organisation: e.organisation ?? null,
      location: e.location ?? null,
      description: e.description ?? null,
      images: (e.images ?? []).map((img) => ({
        url: img.url,
        alt: img.alt ?? null,
        width: img.width ?? null,
        height: img.height ?? null,
      })),
      profileLinks: (e.links ?? []).map((l) => l.href).filter(Boolean),
      sameAs: e.sameAs ?? [],
      jsonLdTypes: e.jsonLdTypes ?? [],
      keywords: e.keywords ?? [],
      emails: e.emails ?? [],
      isArticle: e.isArticle ?? false,
      articlePublisher: e.articlePublisher ?? null,
      loginWall: e.loginWall ?? false,
      challengePage: e.challengePage ?? false,
      headings: e.headings ?? [],
      platformDataUnavailable: e.platformDataUnavailable ?? false,
    },
    platform: s.platform as InspectionResult['platform'],
    platformHandle: s.platform_handle,
    platformNote: s.qualifiers?.platformNote ?? null,
    platformData: null,
    isPersonalSite: false,
    elapsedMs: 0,
  };
}

/** Step 5 — attribute claims to their sources, with provenance and independence. */
export async function buildProvenance(entityId: string): Promise<number> {
  const claims = await listClaims(entityId);
  const sources = await listSources(entityId);
  const links = await listIdentityLinks(entityId);
  const confirmedSourceIds = new Set(
    links.filter((l) => l.resolved_state === IdentityState.confirmed || l.user_decision === 'accept').map((l) => l.source_id),
  );

  // Group independent sources per registrable domain + independence fingerprint so that four
  // pages on one host, or four copies of one release, count once.
  const independenceBySource = new Map<string, Set<string>>();
  for (const s of sources) {
    const group = `${s.registrable_domain ?? s.host ?? 'unknown'}|${s.independence_group ?? 'none'}`;
    const set = independenceBySource.get(group) ?? new Set<string>();
    set.add(s.id);
    independenceBySource.set(group, set);
  }
  const groupOf = new Map<string, string>();
  for (const [group, ids] of independenceBySource) for (const id of ids) groupOf.set(id, group);

  let processed = 0;
  for (const claim of claims) {
    const url = (claim.value_json['url'] as string | undefined) ?? null;
    let sourceId: string | null = null;
    if (url) {
      const canon = canonicalizeUrl(url);
      if (canon.ok) {
        // Match the most relevant source with this canonical URL.
        const candidates = sources.filter((s) => s.canonical_url === canon.canonical);
        sourceId = candidates.sort((a, b) => b.subject_relevance - a.subject_relevance)[0]?.id ?? null;
      }
    }

    if (sourceId && claim.source_id !== sourceId) {
      await attachClaimSource(entityId, claim.id, sourceId);
    }

    const source = sourceId ? sources.find((s) => s.id === sourceId) : null;
    const group = sourceId ? (groupOf.get(sourceId) ?? null) : null;

    // Support strength: independent source groups, not raw source count.
    let support: SupportStrength = SupportStrength.selfAsserted;
    if (sourceId && confirmedSourceIds.has(sourceId)) {
      const independentGroups = countIndependentGroupsForUrl(sources, url, groupOf);
      support = independentGroups >= 2 ? SupportStrength.corroborated : SupportStrength.singleSource;
    } else if (sourceId) {
      support = SupportStrength.singleSource;
    }

    const independenceGroups = url ? countIndependentGroupsForUrl(sources, url, groupOf) : 0;

    let status = claim.status;
    if (claim.origin === ClaimOrigin.user) {
      status = claim.user_confirmed ? ClaimStatus.acceptedAuthoritative : ClaimStatus.userProvided;
    } else if (sourceId && confirmedSourceIds.has(sourceId)) {
      status = independenceGroups >= 2 ? ClaimStatus.independentlySupported : ClaimStatus.sourced;
    } else {
      status = ClaimStatus.uncertain;
    }

    await updateClaimStatus(claim.id, {
      status,
      supportStrength: support,
      confidence: support === SupportStrength.corroborated ? 0.8 : support === SupportStrength.singleSource ? 0.55 : 0.5,
      verified: status === ClaimStatus.sourced || status === ClaimStatus.independentlySupported || status === ClaimStatus.acceptedAuthoritative,
    });

    if (sourceId) {
      await insertEvidence({
        entityId,
        claimId: claim.id,
        sourceId,
        kind: claim.origin === ClaimOrigin.user ? 'user_assertion' : 'source_assertion',
        strength: support === SupportStrength.corroborated ? 0.8 : 0.55,
        independenceGroup: group,
        detail: `Claim "${claim.value_text}" attributed to ${source?.canonical_url ?? 'source'}`,
        payload: { support, independenceGroups },
      });
    }
    processed += 1;
  }
  log.info('provenance built', { entityId, processed });
  return processed;
}

async function attachClaimSource(entityId: string, claimId: string, sourceId: string): Promise<void> {
  await query(
    `UPDATE claims SET source_id = $3, independence_group = $4, updated_at = now() WHERE id = $1 AND entity_id = $2`,
    [claimId, entityId, sourceId, (await independenceGroupOf(sourceId))],
  );
}

async function independenceGroupOf(sourceId: string): Promise<string | null> {
  const rows = await query<{ independence_group: string | null; registrable_domain: string | null; host: string | null }>(
    'SELECT independence_group, registrable_domain, host FROM sources WHERE id = $1',
    [sourceId],
  );
  const r = rows[0];
  if (!r) return null;
  return `${r.registrable_domain ?? r.host ?? 'unknown'}|${r.independence_group ?? 'none'}`;
}

function countIndependentGroupsForUrl(
  sources: SourceRecord[],
  url: string | null,
  groupOf: Map<string, string>,
): number {
  if (!url) return 0;
  const canon = canonicalizeUrl(url);
  if (!canon.ok) return 0;
  const matching = sources.filter((s) => {
    if (!s.is_duplicate_of && s.canonical_url === canon.canonical) return true;
    // Different pages on the same site that both state the same attribute still count once.
    return s.registrable_domain !== null && s.registrable_domain === registrableDomain(canon.canonical);
  });
  return new Set(matching.map((s) => groupOf.get(s.id) ?? s.id)).size;
}

/** Step 6 — conflicts and logical contradictions. */
export async function detectAndStoreConflicts(entityId: string): Promise<number> {
  const claims = await listClaims(entityId);
  const sources = await listSources(entityId);
  const sourceMeta: Record<string, { url: string; title: string | null; sourceType: SourceType | null; independenceGroup: string | null }> = {};
  for (const s of sources) {
    sourceMeta[s.id] = { url: s.canonical_url, title: s.title, sourceType: s.source_type as SourceType, independenceGroup: s.independence_group };
  }

  // Clear stale conflicts so re-running the pipeline never duplicates them.
  const existing = await listConflicts(entityId);
  for (const c of existing) {
    if (c.status === 'open') await resolveConflict(c.id, 'dismissed', 'Superseded by a newer analysis run.');
  }

  const detected = [...detectConflicts({ claims, sourceMeta }), ...detectLogicalContradictions(claims)];
  const merged = mergeConflicts(detected);
  log.info('conflicts computed in memory', {
    entityId,
    claims: claims.length,
    detected: detected.length,
    merged: merged.length,
    blocking: merged.filter((c) => c.severity === 'blocking').length,
    byAttribute: [...merged.reduce((m, c) => m.set(c.attributeKey, (m.get(c.attributeKey) ?? 0) + 1), new Map<string, number>())]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8),
  });

  for (const c of merged) {
    const rec = await insertConflict({
      entityId,
      attributeKey: c.attributeKey,
      kind: c.kind,
      severity: c.severity,
      claimIds: c.claimIds,
      sourceIds: c.sourceIds,
      description: c.description,
      userMessage: c.userMessage,
      evidence: c.evidence as Record<string, unknown>,
    });
    for (const cid of c.claimIds) {
      await insertEvidence({
        entityId,
        claimId: cid,
        sourceId: c.sourceIds[0] ?? null,
        kind: 'contradiction',
        strength: 0.9,
        detail: c.description,
        payload: c.evidence as Record<string, unknown>,
      });
    }
    await insertReviewItem({
      entityId,
      kind: 'conflict',
      title:
        c.severity === 'blocking'
          ? 'Blocking: your sources disagree'
          : 'Your sources describe this differently',
      detail: c.userMessage,
      proposed: { conflictId: rec.id, attributeKey: c.attributeKey, claimIds: c.claimIds },
      conflictId: rec.id,
      stageKey: c.attributeKey.startsWith('career') || c.attributeKey.startsWith('education') ? 'E_career' : 'D_professional_identity',
      blocking: c.severity === 'blocking',
    });
  }
  log.info('conflicts detected', { entityId, count: merged.length });
  return merged.length;
}

function mergeConflicts(detected: ReturnType<typeof detectConflicts>): ReturnType<typeof detectConflicts> {
  const out: ReturnType<typeof detectConflicts> = [];
  const seen = new Set<string>();
  for (const c of detected) {
    const key = `${c.attributeKey}|${[...c.claimIds].sort().join(',')}|${c.kind}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(c);
  }
  return out;
}

/** Step 7 — ambiguity detection. */
export async function detectAndStoreAmbiguity(
  entityId: string,
  subject: SubjectProfile,
  options: { model?: ModelRef | null; failures?: AiFailureCollector } = {},
): Promise<number> {
  const claims = await listClaims(entityId);
  const sources = await listSources(entityId);
  const links = await listIdentityLinks(entityId);
  const openConflicts = (await listConflicts(entityId, true)).map((c) => c.attribute_key);

  const found = runAmbiguityDetection(
    {
      subject: {
        names: subject.names,
        aliases: subject.aliases,
        professions: subject.professions,
        organizations: subject.organizations,
        locations: subject.locations ?? [],
        biography: subject.biography ?? null,
        handle: subject.handle ?? null,
      },
      claims,
      sources: sources.map((s) => ({ id: s.id, url: s.canonical_url, title: s.title, independence_group: s.independence_group })),
      identityLinks: links.map((l) => ({
        source_id: l.source_id,
        resolved_state: l.resolved_state,
        score: l.score,
        signals: l.signals,
        rationale: l.rationale,
        user_decision: l.user_decision,
      })),
    },
    openConflicts,
  );

  const prior = await listAmbiguities(entityId);
  for (const a of prior) {
    if (a.status === 'open') await resolveAmbiguityIfNeeded(a.id);
  }

  for (const a of found) {
    await insertAmbiguity({
      entityId,
      dimension: a.dimension,
      description: a.description,
      candidates: a.candidates,
      missingEvidence: a.missingEvidence,
      severity: a.severity,
    });
    await insertReviewItem({
      entityId,
      kind: 'ambiguity',
      title:
        a.severity === 'blocking'
          ? 'Blocking: this could describe more than one person'
          : 'Worth checking: is this clearly you?',
      detail: `${a.description}\n\nWhat would resolve it: ${a.missingEvidence.join(' ')}`,
      proposed: { dimension: a.dimension, candidates: a.candidates },
      stageKey: 'B_name_variants',
      blocking: a.severity === 'blocking',
    });
  }
  // AI second opinion on ambiguity. The deterministic result stays authoritative: this can only add
  // a review item that names what evidence would settle the question. It can never clear a
  // deterministic ambiguity and it can never turn a resolved one into a problem.
  if (options.model) {
    const failures = (options.failures ??= []);
    const assessment = await safeAi(failures, 'ambiguity_assessment', () =>
      assessAmbiguity({
        model: options.model as ModelRef,
        entityName: subject.names[0] ?? '',
        claims: claims.map((c) => ({
          attributeKey: c.attribute_key,
          value: c.value_text,
          origin: c.origin,
          status: c.status,
        })),
        sources: sources.map((s) => ({
          url: s.canonical_url,
          title: s.title,
          accessStatus: s.access_status,
          qualifies: s.qualifies_websites || s.qualifies_press,
        })),
        deterministicFindings: found.map((a) => ({ dimension: a.dimension, description: a.description })),
      }),
    );
    if (assessment?.couldDescribeMultiplePeople) {
      await insertReviewItem({
        entityId,
        kind: 'ambiguity',
        title: 'Worth checking: could this describe someone else?',
        detail: `${assessment.reason}\n\nWhat would settle it: ${assessment.missingDistinguishingEvidence.join(' ') || 'confirmation from you.'}`,
        proposed: {
          source: 'ai_second_opinion',
          dimension: 'ai_ambiguity',
          candidates: [],
          missingEvidence: assessment.missingDistinguishingEvidence,
          suggestedQuestions: assessment.suggestedQuestions,
        },
        stageKey: 'B_name_variants',
        blocking: false,
      });
    }
  }

  log.info('ambiguity assessed', { entityId, count: found.length });
  return found.length;
}

async function resolveAmbiguityIfNeeded(ambiguityId: string): Promise<void> {
  await resolveAmbiguity(ambiguityId, 'dismissed', 'Superseded by a newer analysis run.');
}

/** Step 8 — evidence minimums snapshot. */
export async function recomputeEvidenceMinimums(entityId: string): Promise<{
  websites: { supplied: number; qualifying: number; required: number; met: boolean };
  pressReleases: { supplied: number; qualifying: number; required: number; met: boolean; independentGroups: number };
  photos: { supplied: number; qualifying: number; required: number; met: boolean };
}> {
  const sources = await listSources(entityId);
  const photos = await listPhotos(entityId);

  // Role-based selection: a source counts toward a minimum only where the person declared it,
  // and the role flags record every declaration independently.
  const websiteCandidates = sources.filter((s) => s.declared_as_website || s.declared_as_profile || s.declared_as_page);
  const pressCandidates = sources.filter((s) => s.declared_as_press);

  const websitesQualifying = websiteCandidates.filter((s) => s.qualifies_websites && !s.is_duplicate_of);
  const pressQualifying = pressCandidates.filter((s) => s.qualifies_press && !s.is_duplicate_of);
  const independentPressGroups = new Set(pressQualifying.map((s) => s.independence_group ?? s.id)).size;
  const photosQualifying = photos.filter((p) => p.qualifies);

  const detail = {
    websites: {
      required: 5,
      qualifying: websitesQualifying.length,
      sources: websiteCandidates.map((s) => ({
        id: s.id,
        url: s.canonical_url,
        qualifies: s.qualifies_websites && !s.is_duplicate_of,
        duplicateOf: s.is_duplicate_of,
        blockers: s.qualifiers.blockers ?? [],
        relevance: s.subject_relevance,
        assessment: s.qualifiers.assessment,
      })),
    },
    pressReleases: {
      required: 4,
      qualifying: pressQualifying.length,
      independentGroups: independentPressGroups,
      sources: pressCandidates.map((s) => ({
        id: s.id,
        url: s.canonical_url,
        qualifies: s.qualifies_press && !s.is_duplicate_of,
        duplicateOf: s.is_duplicate_of,
        independenceGroup: s.independence_group,
        blockers: s.qualifiers.blockers ?? [],
        relevance: s.subject_relevance,
      })),
    },
    photos: {
      required: 4,
      qualifying: photosQualifying.length,
      items: photos.map((p) => ({
        id: p.id,
        qualifies: p.qualifies,
        width: p.width,
        height: p.height,
        reasons: p.disqualify_reasons,
      })),
    },
    notice: 'Nexora Entity internal evidence requirements. Not requirements imposed by Google or any other search engine.',
  };

  await saveEvidenceMinimums({
    entityId,
    websitesSupplied: websiteCandidates.length,
    websitesQualifying: websitesQualifying.length,
    pressSupplied: pressCandidates.length,
    pressQualifying: pressQualifying.length,
    photosSupplied: photos.length,
    photosQualifying: photosQualifying.length,
    independentPressGroups,
    detail,
  });

  void ALL_EVIDENCE_MINIMUMS;
  return {
    websites: { supplied: websiteCandidates.length, qualifying: websitesQualifying.length, required: 5, met: websitesQualifying.length >= 5 },
    pressReleases: { supplied: pressCandidates.length, qualifying: pressQualifying.length, required: 4, met: pressQualifying.length >= 4, independentGroups: independentPressGroups },
    photos: { supplied: photos.length, qualifying: photosQualifying.length, required: 4, met: photosQualifying.length >= 4 },
  };
}

/** Full deterministic run. */
export async function runAnalysis(
  entityId: string,
  options: PipelineOptions = {},
): Promise<Omit<PipelineResult, 'aiFailures'> & { aiFailures: AiFailure[] }> {
  const started = Date.now();
  options.onProgress?.('Reading your information', 5);

  // The account's verified provider/model powers the AI-assisted operations. It is resolved here
  // rather than passed in, so every caller - a stage save, a manual re-check, the scheduled
  // maintenance run - uses the person's active configuration automatically.
  const failures: AiFailureCollector = [];
  const model = options.useAi === false ? null : (options.model ?? (await resolveAccountModel(entityId)));
  if (options.useAi !== false && !model) {
    log.info('no verified AI configuration; running the deterministic analysis only', { entityId });
  }

  await ingestStages(entityId, options.stageKeys);
  const claims = await listClaims(entityId);
  const subject = buildSubjectProfile(claims, await listSources(entityId));

  options.onProgress?.('Checking your websites and profiles', 15);
  const inspect = await inspectSources(entityId, subject, {
    force: options.forceReinspect,
    onProgress: options.onProgress,
    model,
    failures,
  });

  options.onProgress?.('Checking for duplicate and copied sources', 45);
  await resolveDuplication(entityId);

  options.onProgress?.('Working out which sources represent you', 55);
  const identities = await resolveIdentities(entityId, subject, { model, failures });

  options.onProgress?.('Recording where every piece of information came from', 65);
  await buildProvenance(entityId);

  // Step 5b — turn what we actually read out of each inspected source into claims that
  // carry that provenance. Without this, every claim originates from the person and the
  // readiness `support_strength` check can never be satisfied by real evidence (§11, §19).
  const provenance = await applyProvenance(entityId);
  log.info('provenance chain built', { entityId, ...provenance });

  options.onProgress?.('Checking for contradictions', 75);
  const conflicts = await detectAndStoreConflicts(entityId);

  options.onProgress?.('Checking whether this could describe more than one person', 82);
  const ambiguities = await detectAndStoreAmbiguity(entityId, subject, { model, failures });

  options.onProgress?.('Checking your evidence', 88);
  const minimums = await recomputeEvidenceMinimums(entityId);

  options.onProgress?.('Running the Entity Readiness review', 94);
  const readiness = await buildReadinessReport(entityId, 'standard', { model, failures });

  const pendingReview = await countPendingReviewItems(entityId);
  const entity = await findEntityById(entityId);
  const graph = await buildGraph(entityId, entity?.display_name ?? 'This person', entity?.entity_uid ?? entityId);

  await audit({
    entityId,
    action: 'analysis.completed',
    actor: 'system',
    detail: {
      inspected: inspect.inspected,
      unreadable: inspect.unreadable,
      conflicts,
      ambiguities,
      score: readiness.score,
      aiFailures: failures.length,
    },
  });

  return {
    entityId,
    sourcesInspected: inspect.inspected,
    sourcesUnreadable: inspect.unreadable,
    identitiesResolved: identities,
    conflictsOpen: conflicts,
    ambiguitiesOpen: ambiguities,
    evidenceMinimums: minimums,
    graph: { nodes: graph.nodes.length, edges: graph.edges.length },
    pendingReview,
    provenance,
    readiness,
    aiFailures: failures,
    durationMs: Date.now() - started,
  };
}

/** Build the entity graph from persisted state. */
export async function buildGraph(entityId: string, entityName: string, entityUid: string) {
  const [claims, sources, evidence, links] = await Promise.all([
    listClaims(entityId),
    listSources(entityId),
    listEvidence(entityId),
    listIdentityLinks(entityId),
  ]);
  return buildEntityGraph({
    subjectName: entityName,
    entityUid,
    claims,
    sources: sources.map((s) => ({
      id: s.id,
      url: s.url,
      canonical_url: s.canonical_url,
      title: s.title,
      source_type: s.source_type as SourceType,
      independence_group: s.independence_group,
      published: s.published,
    })),
    evidence: evidence.map((e) => ({
      claim_id: e.claim_id,
      kind: e.kind,
      strength: Number(e.strength),
      detail: e.detail,
      obtained_at: e.obtained_at,
      source_id: e.source_id,
    })),
    confirmedSourceIds: links.filter((l) => l.resolved_state === IdentityState.confirmed || l.user_decision === 'accept').map((l) => l.source_id),
  });
}

/** Assemble the readiness report from persisted state. */
export async function buildReadinessReport(
  entityId: string,
  kind: 'standard' | 'second_pass' = 'standard',
  options: { model?: ModelRef | null; failures?: AiFailureCollector } = {},
): Promise<ReadinessReport> {
  const [claims, sources, photos, stages, conflicts, ambiguities, links, portfolioFiles, reviewItems, minima] = await Promise.all([
    listClaims(entityId),
    listSources(entityId),
    listPhotos(entityId),
    listStageProgress(entityId),
    listConflicts(entityId),
    listAmbiguities(entityId),
    listIdentityLinks(entityId),
    listPortfolioFiles(entityId),
    listReviewItems(entityId, true),
    latestEvidenceMinimums(entityId),
  ]);

  const websiteQualifying = await countQualifyingWebsites(entityId);
  const pressQualifying = await countQualifyingPress(entityId);
  const photosQualifying = await countQualifyingPhotos(entityId);

  const primaryName =
    claims.find((c) => c.attribute_key === 'identity.primaryName')?.value_text ??
    claims.find((c) => c.attribute_key === 'identity.fullPublicName')?.value_text ??
    'this entity';

  const sd = structuredDataFor({ claims, sources, photos, identityLinks: links });

  const report = evaluateReadiness({
    kind,
    entityName: primaryName,
    claims,
    sources,
    photos,
    stages,
    conflicts,
    ambiguities,
    identityLinks: links,
    websiteQualifying,
    pressQualifying,
    photosQualifying,
    independentPressGroups: minima?.independent_press_groups ?? 0,
    portfolioFiles: portfolioFiles.map((f) => ({ extraction_status: f.extraction_status, extraction_error: f.extraction_error, extraction: f.extraction as Record<string, unknown> })),
    portfolioDiscoveriesPending: reviewItems.filter((r) => r.kind === 'portfolio_discovery').length,
    reviewPending: reviewItems.length,
    reviewBlocking: reviewItems.filter((r) => r.blocking).length,
    correctionsSinceParent: 0,
    publishableClaimCount: claims.filter((c) => c.publish).length,
    structuredData: sd,
    liveDeployment: false,
    liveDeploymentTarget: null,
  });

  // The narrative explains the deterministic result in plain language. It never changes the
  // verdict: the deterministic gate is the only thing that can decide readiness.
  if (options.model) {
    const failures = (options.failures ??= []);
    const narrative = await safeAi(failures, 'readiness_narration', () =>
      narrateReadiness({
        model: options.model as ModelRef,
        entityName: primaryName,
        deterministicStatus: report.status === 'ready' ? 'ready' : 'blocked',
        score: report.score,
        blockingIssues: report.blockingIssues.map((b) => ({ title: b.title, detail: b.detail, action: b.action })),
        warnings: report.warnings.map((w) => ({ title: w.title, detail: w.detail })),
        completenessNarrative: report.completeness.narrative,
      }),
    );
    if (narrative) {
      return { ...report, narrative: { ...narrative, verdict: report.status === 'ready' ? 'ready' : 'blocked' } };
    }
  }

  return report;
}

export { setSourcePublished, ReadinessCheckId, Severity, ReviewKind };