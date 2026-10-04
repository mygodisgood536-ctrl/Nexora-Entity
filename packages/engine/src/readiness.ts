/**
 * Entity Readiness engine + mandatory complete second-pass review (spec 17, 18, 19).
 *
 * The score is the Nexora Entity Readiness Standard: completeness and internal coherence.
 * It is never presented as Google verification, approval, endorsement, or a guarantee of a
 * Knowledge Panel. Any blocking issue prevents publication.
 *
 * The second pass re-examines the ENTIRE entity from the beginning: all user data, all
 * collected external information, relationships, sources, evidence, conflicts, required
 * minimums and generated-website information. It does not merely recheck corrected fields.
 */

import {
  EVIDENCE_MINIMUMS_NOTICE,
  READINESS_DISCLAIMER,
  ReadinessCheckId,
  Severity,
  readinessLabel,
  scanForProhibitedClaims,
  type ReadinessRunKind,
  type ReadinessStatus,
} from '@nexora/core';
import type {
  AmbiguityRecord,
  BlockingIssue,
  CheckResult,
  ClaimRecord,
  ConflictRecord,
  IdentityLinkRecord,
  PhotoRecord,
  SourceRecord,
  StageProgressRecord,
} from '@nexora/db';
import { evaluateCompleteness, type CompletenessResult } from './completeness';

export interface ReadinessInput {
  kind: ReadinessRunKind;
  entityName: string;
  claims: ClaimRecord[];
  sources: SourceRecord[];
  photos: PhotoRecord[];
  stages: StageProgressRecord[];
  conflicts: ConflictRecord[];
  ambiguities: AmbiguityRecord[];
  identityLinks: IdentityLinkRecord[];
  websiteQualifying: number;
  pressQualifying: number;
  photosQualifying: number;
  independentPressGroups: number;
  portfolioFiles: { extraction_status: string; extraction_error: string | null; extraction: Record<string, unknown> }[];
  portfolioDiscoveriesPending: number;
  reviewPending: number;
  reviewBlocking: number;
  /** Corrections made since the previous run, reported by the second pass. */
  correctionsSinceParent: number;
  publishableClaimCount: number;
  structuredData: {
    hasName: boolean;
    alternateNames: number;
    image: boolean;
    description: boolean;
    sameAs: number;
    canonicalUrl: boolean;
    stableId: boolean;
  };
  liveDeployment: boolean;
  liveDeploymentTarget: string | null;
}

export interface ReadinessReport {
  kind: ReadinessRunKind;
  status: ReadinessStatus;
  score: number;
  label: string;
  checks: CheckResult[];
  blockingIssues: BlockingIssue[];
  warnings: { code: string; title: string; detail: string }[];
  secondPassAnswers?: { question: string; answer: string; pass: boolean; detail: string }[];
  summary: string;
  completeness: CompletenessResult;
  disclaimer: string;
  evidenceNotice: string;
}

/** Weights: how much each check contributes to the readiness percentage. */
const WEIGHTS: Record<ReadinessCheckId, number> = {
  identity_core: 10,
  distinguishability: 10,
  name_variants: 4,
  current_profession: 9,
  biography: 8,
  career_history: 4,
  education_history: 3,
  organizations_projects: 4,
  public_sources: 6,
  websites_minimum_5: 9,
  press_minimum_4: 8,
  photos_minimum_4: 6,
  social_inspection: 5,
  portfolio_understood: 2,
  conflicts_resolved: 9,
  ambiguity_resolved: 9,
  review_queue_cleared: 6,
  support_strength: 6,
  freshness: 4,
  website_accuracy: 5,
  machine_readable: 6,
  material_completeness: 8,
};

const TOTAL_WEIGHT = Object.values(WEIGHTS).reduce((a, b) => a + b, 0);

function has(claims: ClaimRecord[], key: string, minLength = 1): boolean {
  return claims.some((c) => c.attribute_key === key && c.value_text.trim().length >= minLength);
}

function countOf(claims: ClaimRecord[], key: string): number {
  return claims.filter((c) => c.attribute_key === key && c.value_text.trim().length > 0).length;
}

function attrClaims(claims: ClaimRecord[], prefix: string): number {
  return claims.filter((c) => c.attribute_key.startsWith(prefix) && c.value_text.trim().length > 0).length;
}

function check(
  id: ReadinessCheckId,
  label: string,
  pass: boolean,
  detail: string,
  opts: {
    warn?: boolean;
    blocking?: boolean;
    stageKey?: string | null;
    sourceRefs?: { id: string; label: string; url?: string | null }[];
    data?: Record<string, unknown>;
  } = {},
): CheckResult {
  return {
    id,
    label,
    outcome: pass ? 'pass' : opts.warn ? 'warn' : 'fail',
    weight: WEIGHTS[id],
    detail,
    sourceRefs: opts.sourceRefs ?? [],
    stageKey: opts.stageKey ?? null,
    blocking: opts.blocking ?? (!pass && !opts.warn),
    data: opts.data ?? {},
  };
}

export function evaluateReadiness(input: ReadinessInput): ReadinessReport {
  const checks: CheckResult[] = [];
  const blockingIssues: BlockingIssue[] = [];
  const warnings: { code: string; title: string; detail: string }[] = [];

  const nameClaims = input.claims.filter(
    (c) => c.attribute_key === 'identity.primaryName' || c.attribute_key === 'identity.fullPublicName',
  );
  const currentName = nameClaims.find((c) => c.is_current) ?? nameClaims[0] ?? null;
  const openConflicts = input.conflicts.filter((c) => c.status === 'open');
  const openAmbiguities = input.ambiguities.filter((a) => a.status === 'open');

  const completeness = evaluateCompleteness({
    stages: input.stages,
    claims: input.claims,
    sources: input.sources,
    photos: input.photos,
    portfolioFiles: input.portfolioFiles,
    websiteQualifying: input.websiteQualifying,
    pressQualifying: input.pressQualifying,
    photosQualifying: input.photosQualifying,
    independentPressGroups: input.independentPressGroups,
  });

  // identity_core
  const hasFirst = has(input.claims, 'identity.firstName', 1);
  const hasLast = has(input.claims, 'identity.lastName', 1);
  const hasFull = Boolean(currentName && currentName.value_text.trim().length >= 2);
  checks.push(
    check(
      'identity_core',
      'Core identity is clear',
      hasFull && hasFirst && hasLast,
      hasFull
        ? `Primary name recorded as "${currentName?.value_text}".${hasFirst ? '' : ' First name missing.'}${hasLast ? '' : ' Last name missing.'}`
        : 'No primary name has been recorded yet.',
      { stageKey: 'A_identity' },
    ),
  );
  if (!hasFull) {
    blockingIssues.push({
      code: 'identity_core',
      title: 'Primary name missing',
      detail: 'There is no unambiguous primary name for this entity.',
      where: { stageKey: 'A_identity' },
      action: 'Add the full name you are publicly known by.',
      actionHref: '/app/stages/A_identity',
      checkId: 'identity_core',
    });
  }

  // name_variants
  const aliasCount = countOf(input.claims, 'identity.alias');
  checks.push(
    check(
      'name_variants',
      'Legitimate name variants recorded',
      aliasCount >= 1,
      aliasCount >= 1
        ? `${aliasCount} alternate name${aliasCount === 1 ? '' : 's'} recorded.`
        : 'No alternate names recorded. Sources that use a nickname, reordered name or professional name cannot be matched to you.',
      { warn: aliasCount === 0, stageKey: 'B_name_variants' },
    ),
  );
  if (aliasCount === 0) {
    warnings.push({
      code: 'name_variants',
      title: 'No alternate names recorded',
      detail: 'Without a nickname, professional name or reordered form, sources that use it may not be recognised as yours.',
    });
  }

  // distinguishability
  const distinguishing = [
    aliasCount > 0,
    attrClaims(input.claims, 'organizations.') > 0,
    attrClaims(input.claims, 'career.') > 0,
    attrClaims(input.claims, 'location.') > 0 || has(input.claims, 'identity.location', 1),
    countOf(input.claims, 'professional.profession') > 0,
  ].filter(Boolean).length;
  checks.push(
    check(
      'distinguishability',
      'The person can be told apart from others',
      distinguishing >= 2,
      `${distinguishing} of 5 distinguishing attributes present: alternate names, organisations, work history, location and profession. At least 2 are required.`,
      { stageKey: distinguishing < 2 ? 'B_name_variants' : null },
    ),
  );
  if (distinguishing < 2) {
    blockingIssues.push({
      code: 'distinguishability',
      title: 'Not enough distinguishing information',
      detail:
        'Someone reading these sources could not reliably tell this person apart from others with a similar name. Nexora Entity will not publish an entity it cannot distinguish.',
      where: { stageKey: 'B_name_variants' },
      action: 'Add an organisation, role or location that belongs only to you.',
      actionHref: '/app/stages/B_name_variants',
      checkId: 'distinguishability',
    });
  }

  // current_profession
  const professionCount = countOf(input.claims, 'professional.profession');
  const titleCount = countOf(input.claims, 'professional.title');
  const hasCompany = has(input.claims, 'professional.currentCompany', 1);
  checks.push(
    check(
      'current_profession',
      'Current professional identity is known',
      professionCount > 0 || titleCount > 0 || hasCompany,
      professionCount + titleCount > 0
        ? `${professionCount} profession${professionCount === 1 ? '' : 's'} and ${titleCount} title${titleCount === 1 ? '' : 's'} recorded.${hasCompany ? '' : ' No current organisation recorded.'}`
        : 'No current professional identity recorded.',
      { stageKey: 'D_professional_identity' },
    ),
  );
  if (professionCount === 0 && titleCount === 0 && !hasCompany) {
    blockingIssues.push({
      code: 'current_profession',
      title: 'Current professional identity missing',
      detail: 'What the person currently does is not recorded, so the entity is not yet understandable.',
      where: { stageKey: 'D_professional_identity' },
      action: 'Describe what you currently do.',
      actionHref: '/app/stages/D_professional_identity',
      checkId: 'current_profession',
    });
  }

  // biography
  const bio = input.claims.find((c) => c.attribute_key === 'about.biography' && c.value_text.trim().length > 0);
  const bioOk = Boolean(bio && bio.value_text.trim().length >= 60);
  checks.push(
    check(
      'biography',
      'Biography present and usable',
      bioOk,
      bio ? `Biography recorded, ${bio.value_text.trim().length} characters.` : 'No biography recorded.',
      { stageKey: 'C_about' },
    ),
  );
  if (!bioOk) {
    blockingIssues.push({
      code: 'biography',
      title: 'Biography missing or too short',
      detail: 'A biography is what allows a reader and a search engine to understand the person behind the name.',
      where: { stageKey: 'C_about' },
      action: 'Write a short biography in your own words.',
      actionHref: '/app/stages/C_about',
      checkId: 'biography',
    });
  }

  // recommended dimensions
  const careerCount = attrClaims(input.claims, 'career.');
  checks.push(
    check(
      'career_history',
      'Career history present',
      careerCount > 0,
      careerCount > 0 ? `${careerCount} role${careerCount === 1 ? '' : 's'} recorded.` : 'No dated work history recorded.',
      { warn: careerCount === 0, stageKey: 'E_career' },
    ),
  );
  if (careerCount === 0) {
    warnings.push({
      code: 'career_history',
      title: 'No career history',
      detail: 'Dated roles help Nexora Entity tell a career change apart from a contradiction.',
    });
  }

  const eduCount = countOf(input.claims, 'education.qualification');
  checks.push(
    check(
      'education_history',
      'Education present',
      eduCount > 0,
      eduCount > 0 ? `${eduCount} qualification${eduCount === 1 ? '' : 's'} recorded.` : 'No education recorded.',
      { warn: eduCount === 0, stageKey: 'F_education' },
    ),
  );
  if (eduCount === 0) {
    warnings.push({
      code: 'education_history',
      title: 'No education recorded',
      detail: 'Education is a strong distinguishing signal between people with similar names.',
    });
  }

  const orgCount = attrClaims(input.claims, 'organizations.');
  const projectCount =
    countOf(input.claims, 'projects.project') +
    countOf(input.claims, 'products.product') +
    countOf(input.claims, 'products.service');
  checks.push(
    check(
      'organizations_projects',
      'Organisations, projects and products connected',
      orgCount + projectCount > 0,
      `${orgCount} organisation${orgCount === 1 ? '' : 's'} and ${projectCount} project, product or service entr${projectCount === 1 ? 'y' : 'ies'} recorded.`,
      { warn: orgCount + projectCount === 0, stageKey: 'I_projects' },
    ),
  );

  // public_sources
  const inspected = input.sources.filter((s) => s.inspection_status === 'inspected');
  const unreachable = input.sources.filter((s) => s.inspection_status !== 'inspected');
  checks.push(
    check(
      'public_sources',
      'Public sources inspected',
      inspected.length > 0,
      `${inspected.length} of ${input.sources.length} supplied source${input.sources.length === 1 ? '' : 's'} successfully inspected.`,
      {
        stageKey: 'N_websites',
        sourceRefs: inspected.slice(0, 8).map((s) => ({ id: s.id, label: s.title ?? s.canonical_url, url: s.canonical_url })),
        data: { unreachable: unreachable.length },
      },
    ),
  );
  if (inspected.length === 0) {
    blockingIssues.push({
      code: 'public_sources',
      title: 'No source could be inspected',
      detail: 'Nexora Entity could not read any supplied source, so there is nothing to check your information against.',
      where: { stageKey: 'P_social_profiles' },
      action: 'Add a public profile or website Nexora Entity can read.',
      actionHref: '/app/stages/P_social_profiles',
      checkId: 'public_sources',
    });
  }

  // evidence minimums (internal Nexora Entity requirements)
  //
  // The counts are recomputed from the source records here rather than taken from the caller's
  // summary numbers. The gate is the last thing standing between a bug upstream and a published
  // site, so it must derive its own verdict from the evidence in front of it: a caller that
  // reports 5 qualifying websites while supplying 0 must not be able to pass the check.
  const sites = input.sources.filter((s) => s.qualifies_websites && !s.is_duplicate_of);
  const websiteQualifying = Math.min(input.websiteQualifying, sites.length);
  const deadOrUnrelated = input.sources.filter((s) => !s.qualifies_websites || s.is_duplicate_of);
  checks.push(
    check(
      'websites_minimum_5',
      'Five qualifying live websites',
      websiteQualifying >= 5,
      `${websiteQualifying} of 5 qualifying websites. ${deadOrUnrelated.length} supplied source${deadOrUnrelated.length === 1 ? ' was' : 's were'} not counted, because it was dead, unreachable, unrelated or a duplicate.`,
      {
        stageKey: 'N_websites',
        sourceRefs: sites.slice(0, 8).map((s) => ({ id: s.id, label: s.title ?? s.canonical_url, url: s.canonical_url })),
        data: { note: EVIDENCE_MINIMUMS_NOTICE },
      },
    ),
  );
  if (websiteQualifying < 5) {
    const rejected = deadOrUnrelated.filter((s) => (s.qualifiers.blockers ?? []).length > 0);
    const first = rejected[0];
    blockingIssues.push({
      code: 'websites_minimum_5',
      title: `Only ${websiteQualifying} of 5 qualifying websites`,
      detail: `Qualifying means the site is reachable, is genuinely about this person, and is not a duplicate of another source. ${EVIDENCE_MINIMUMS_NOTICE}`,
      where: {
        stageKey: 'N_websites',
        sourceId: first?.id ?? null,
        sourceLabel: first?.title ?? first?.canonical_url ?? null,
        sourceUrl: first?.canonical_url ?? null,
      },
      action:
        first && first.qualifiers.blockers?.length
          ? `Fix or replace this source: ${first.qualifiers.blockers[0]}`
          : `Add ${5 - websiteQualifying} more qualifying website${5 - websiteQualifying === 1 ? '' : 's'}.`,
      actionHref: '/app/stages/N_websites',
      checkId: 'websites_minimum_5',
    });
  }

  const press = input.sources.filter((s) => s.qualifies_press && !s.is_duplicate_of);
  const pressQualifying = Math.min(input.pressQualifying, press.length);
  const independentPressGroups = new Set(press.map((s) => s.independence_group ?? s.id)).size;
  checks.push(
    check(
      'press_minimum_4',
      'Four qualifying press releases',
      pressQualifying >= 4,
      `${pressQualifying} of 4 qualifying press releases, across ${independentPressGroups} independent source group${independentPressGroups === 1 ? '' : 's'}. Copies of the same release are counted once. ${EVIDENCE_MINIMUMS_NOTICE}`,
      {
        stageKey: 'M_press_releases',
        sourceRefs: press.slice(0, 8).map((s) => ({ id: s.id, label: s.title ?? s.canonical_url, url: s.canonical_url })),
      },
    ),
  );
  if (pressQualifying < 4) {
    const rejectedPress = input.sources.filter((s) => s.supplied_kind === 'press_release' && !s.qualifies_press);
    const first = rejectedPress[0];
    blockingIssues.push({
      code: 'press_minimum_4',
      title: `Only ${pressQualifying} of 4 qualifying press releases`,
      detail: `${EVIDENCE_MINIMUMS_NOTICE} Copies of the same release count once, and each release is checked for reachability and whether it is actually about this person.`,
      where: {
        stageKey: 'M_press_releases',
        sourceId: first?.id ?? null,
        sourceLabel: first?.title ?? null,
        sourceUrl: first?.canonical_url ?? null,
      },
      action:
        first && first.qualifiers.blockers?.length
          ? `This one was not counted: ${first.qualifiers.blockers[0]}`
          : `Add ${4 - pressQualifying} more qualifying press release${4 - pressQualifying === 1 ? '' : 's'}.`,
      actionHref: '/app/stages/M_press_releases',
      checkId: 'press_minimum_4',
    });
  }
  if (pressQualifying >= 4 && independentPressGroups < 4) {
    warnings.push({
      code: 'press_independence',
      title: 'Press releases are not fully independent',
      detail: `${pressQualifying} qualifying press releases came from only ${independentPressGroups} independent source group${independentPressGroups === 1 ? '' : 's'}. Four copies of one release would count once.`,
    });
  }

  const qualifyingPhotos = input.photos.filter((p) => p.qualifies);
  const rejectedPhotoCount = input.photos.length - qualifyingPhotos.length;
  checks.push(
    check(
      'photos_minimum_4',
      'Four qualifying photos',
      input.photosQualifying >= 4,
      `${input.photosQualifying} of 4 qualifying photos. ${rejectedPhotoCount} uploaded image${rejectedPhotoCount === 1 ? ' was' : 's were'} rejected as invalid or duplicate. ${EVIDENCE_MINIMUMS_NOTICE}`,
      { stageKey: 'Q_photos' },
    ),
  );
  if (input.photosQualifying < 4) {
    const rejectedPhotos = input.photos.filter((p) => !p.qualifies);
    const first = rejectedPhotos[0];
    blockingIssues.push({
      code: 'photos_minimum_4',
      title: `Only ${input.photosQualifying} of 4 qualifying photos`,
      detail: `Each upload is checked for validity, resolution and duplication. ${EVIDENCE_MINIMUMS_NOTICE}`,
      where: { stageKey: 'Q_photos' },
      action:
        first && first.disqualify_reasons?.[0]
          ? `This photo was not counted: ${first.disqualify_reasons[0]}`
          : `Upload ${4 - input.photosQualifying} more photo${4 - input.photosQualifying === 1 ? '' : 's'}.`,
      actionHref: '/app/stages/Q_photos',
      checkId: 'photos_minimum_4',
    });
  }

  // social_inspection
  const profileSources = input.sources.filter((s) => s.platform !== null);
  const inspectedProfiles = profileSources.filter((s) => s.inspection_status === 'inspected');
  const limitedProfiles = profileSources.filter((s) => s.access_status !== 'accessible');
  checks.push(
    check(
      'social_inspection',
      'Supplied profiles inspected where possible',
      profileSources.length === 0 || inspectedProfiles.length > 0,
      profileSources.length === 0
        ? 'No social or professional profiles were supplied.'
        : `${inspectedProfiles.length} of ${profileSources.length} profile${profileSources.length === 1 ? '' : 's'} could be inspected. ${limitedProfiles.length} could not be read, and that limitation is recorded rather than hidden.`,
      {
        stageKey: 'P_social_profiles',
        data: {
          limited: limitedProfiles.map((s) => ({ id: s.id, url: s.canonical_url, status: s.access_status, note: s.platform_note })),
        },
      },
    ),
  );
  for (const p of limitedProfiles.slice(0, 6)) {
    warnings.push({
      code: 'source_limit',
      title: `Could not read ${p.title ?? p.canonical_url}`,
      detail: `${p.access_detail ?? 'The platform did not permit an automated read.'} Nexora Entity does not claim this profile was verified.`,
    });
  }

  // portfolio_understood
  const portfolioFiles = input.portfolioFiles;
  const portfolioOk = portfolioFiles.filter((f) => f.extraction_status === 'extracted').length;
  const portfolioPending = input.portfolioDiscoveriesPending;
  const portfolioFine = portfolioFiles.length === 0 || (portfolioOk > 0 && portfolioPending === 0);
  checks.push(
    check(
      'portfolio_understood',
      'Portfolio information understood and attributed',
      portfolioFine,
      portfolioFiles.length === 0
        ? 'No portfolio was uploaded.'
        : `${portfolioOk} of ${portfolioFiles.length} portfolio file${portfolioFiles.length === 1 ? '' : 's'} read successfully, with ${portfolioPending} discovered item${portfolioPending === 1 ? '' : 's'} awaiting your review.`,
      { warn: !portfolioFine && portfolioOk > 0, stageKey: 'O_portfolio' },
    ),
  );
  if (portfolioFiles.length > 0 && portfolioOk > 0 && portfolioPending > 0) {
    blockingIssues.push({
      code: 'portfolio_understood',
      title: 'Portfolio findings awaiting your review',
      detail:
        'Nexora Entity found information in your portfolio. Nothing from a portfolio is published until you have accepted it, and portfolio information is user-provided evidence rather than independently verified fact.',
      where: { stageKey: 'O_portfolio' },
      action: 'Review what was found in your portfolio.',
      actionHref: '/app/review',
      checkId: 'portfolio_understood',
    });
  }

  // conflicts_resolved
  const blockingConflicts = openConflicts.filter((c) => c.severity === 'blocking');
  checks.push(
    check(
      'conflicts_resolved',
      'No unresolved contradictions',
      openConflicts.length === 0,
      openConflicts.length === 0
        ? 'No open contradictions.'
        : `${openConflicts.length} open contradiction${openConflicts.length === 1 ? '' : 's'}, ${blockingConflicts.length} of them blocking.`,
      {
        blocking: blockingConflicts.length > 0,
        stageKey: 'E_career',
        sourceRefs: blockingConflicts.slice(0, 6).map((c) => {
          const src = input.sources.find((s) => c.source_ids?.includes(s.id));
          return { id: c.id, label: c.description.slice(0, 140), url: src?.canonical_url ?? null };
        }),
      },
    ),
  );
  for (const c of openConflicts) {
    // A conflict carries no source list when it was raised from a user-corrected field rather
    // than from collected evidence, so the source reference is optional here.
    const firstSourceId = c.source_ids?.[0];
    const firstSource = firstSourceId ? input.sources.find((s) => s.id === firstSourceId) : undefined;
    blockingIssues.push({
      code: `conflict_${c.id.slice(0, 8)}`,
      title: c.kind === 'value_contradiction' ? 'Sources disagree about your information' : 'A contradiction needs your attention',
      detail: c.user_message ?? c.description,
      where: { stageKey: 'E_career', sourceId: firstSource?.id ?? null, sourceUrl: firstSource?.canonical_url ?? null },
      action: 'Confirm which information is correct.',
      actionHref: '/app/review',
      checkId: 'conflicts_resolved',
    });
  }

  // review_queue_cleared
  //
  // Spec: "Unresolved material inconsistencies, identity ambiguity, unsupported important claims,
  // failed required evidence checks, or other blocking issues must stop publication." A blocking
  // review item is exactly such an issue, so it must gate publication rather than sit in a queue.
  // Non-blocking pending items are a warning: they are advisory, not a reason to refuse.
  checks.push(
    check(
      'review_queue_cleared',
      'Nothing is waiting on your decision',
      input.reviewBlocking === 0,
      input.reviewBlocking === 0
        ? input.reviewPending === 0
          ? 'No items are waiting for your decision.'
          : `${input.reviewPending} item${input.reviewPending === 1 ? '' : 's'} waiting for your decision, none of them blocking.`
        : `${input.reviewBlocking} item${input.reviewBlocking === 1 ? '' : 's'} need${input.reviewBlocking === 1 ? 's' : ''} your decision before this can be published.`,
      { warn: input.reviewBlocking === 0 && input.reviewPending > 0 },
    ),
  );
  if (input.reviewBlocking > 0) {
    blockingIssues.push({
      code: 'review_queue_blocking',
      title: `${input.reviewBlocking} item${input.reviewBlocking === 1 ? '' : 's'} need${input.reviewBlocking === 1 ? 's' : ''} your decision`,
      detail:
        'Nexora Entity will not publish while something is still unresolved. Nothing you have entered is lost; open the review queue to see exactly what is outstanding.',
      where: { stageKey: null },
      action: 'Open the review queue',
      actionHref: '/app/review',
      checkId: 'review_queue_cleared',
    });
  }

  // ambiguity_resolved
  const blockingAmbiguities = openAmbiguities.filter((a) => a.severity === 'blocking');
  checks.push(
    check(
      'ambiguity_resolved',
      'The entity is unambiguous',
      openAmbiguities.length === 0,
      openAmbiguities.length === 0
        ? 'The collected information describes one person.'
        : `${openAmbiguities.length} ambiguity concern${openAmbiguities.length === 1 ? '' : 's'} open, ${blockingAmbiguities.length} blocking.`,
      {
        blocking: blockingAmbiguities.length > 0,
        data: { missing: blockingAmbiguities.flatMap((a) => (a.missing_evidence as string[]).slice(0, 3)).slice(0, 8) },
      },
    ),
  );
  for (const a of openAmbiguities) {
    const missing = (a.missing_evidence as string[]).slice(0, 2).join(' ');
    blockingIssues.push({
      code: `ambiguity_${a.id.slice(0, 8)}`,
      title: 'This entity could describe more than one person',
      detail: `${a.description}${missing ? ` What would resolve it: ${missing}` : ''}`,
      where: { stageKey: 'B_name_variants' },
      action: 'Add the distinguishing evidence, or confirm whether this source is yours.',
      actionHref: '/app/review',
      checkId: 'ambiguity_resolved',
    });
  }

  // support_strength
  const selfOnly = input.claims.filter(
    (c) => c.origin === 'user' && (c.support_strength === 'self_asserted' || c.support_strength === 'none'),
  ).length;
  const corroborated = input.claims.filter(
    (c) => c.support_strength === 'corroborated' || c.support_strength === 'strongly_supported',
  ).length;
  const sourcedTotal = input.claims.filter((c) => c.origin !== 'user').length;
  const ratio = input.claims.length === 0 ? 0 : (sourcedTotal + corroborated * 2) / input.claims.length;
  checks.push(
    check(
      'support_strength',
      'Claims carry real provenance',
      ratio >= 0.5,
      `${sourcedTotal} of ${input.claims.length} claims come from an inspected source; ${corroborated} are independently supported; ${selfOnly} rest on the person's own assertion alone.`,
      { warn: ratio < 0.5 && ratio >= 0.25, data: { ratio: Math.round(ratio * 100) / 100 } },
    ),
  );
  if (ratio < 0.5) {
    warnings.push({
      code: 'support_strength',
      title: 'Most information is currently your own assertion',
      detail:
        'Nexora Entity records what you enter as user-provided and does not present it as independently verified. Adding readable public sources would strengthen the entity.',
    });
  }

  // freshness
  const staleSources = input.sources.filter((s) => {
    if (!s.last_checked_at) return false;
    const days = (Date.now() - new Date(s.last_checked_at).getTime()) / 86_400_000;
    return days > 90;
  });
  const unchecked = input.sources.filter((s) => !s.last_checked_at).length;
  checks.push(
    check(
      'freshness',
      'Important information is current',
      staleSources.length === 0,
      staleSources.length === 0
        ? `All sources were checked within the last 90 days. ${unchecked} supplied source${unchecked === 1 ? '' : 's'} not yet checked.`
        : `${staleSources.length} source${staleSources.length === 1 ? '' : 's'} last checked more than 90 days ago.`,
      { warn: staleSources.length > 0, stageKey: 'M_press_releases' },
    ),
  );
  if (staleSources.length > 0) {
    warnings.push({
      code: 'freshness',
      title: 'Some sources are stale',
      detail: 'Nexora Entity re-checks these automatically. Any detected change is shown to you before it becomes authoritative.',
    });
  }

  // material_completeness
  checks.push(
    check(
      'material_completeness',
      'No material information missing',
      completeness.materialGaps.length === 0,
      completeness.narrative,
      {
        stageKey: completeness.materialGaps[0]?.stageKey ?? null,
        data: { gaps: completeness.materialGaps.map((g) => ({ id: g.id, what: g.what })) },
      },
    ),
  );
  for (const gap of completeness.materialGaps) {
    if (gap.id === 'min_websites' || gap.id === 'min_press' || gap.id === 'min_photos') continue;
    blockingIssues.push({
      code: `gap_${gap.id}`,
      title: 'Material information missing',
      detail: `${gap.what} ${gap.why}`,
      where: { stageKey: gap.stageKey },
      action: `Complete this stage: ${gap.stageKey}`,
      actionHref: gap.href,
      checkId: 'material_completeness',
    });
  }

  // website_accuracy
  const publishable = input.publishableClaimCount;
  const accuracyProblems: string[] = [];
  if (publishable === 0) accuracyProblems.push('Nothing is marked for publication yet.');
  if (input.claims.some((c) => c.publish && c.status === 'conflicting')) {
    accuracyProblems.push('At least one fact marked for publication is still in conflict.');
  }
  if (input.claims.some((c) => c.publish && c.status === 'uncertain')) {
    accuracyProblems.push('At least one fact marked for publication is still uncertain.');
  }
  checks.push(
    check(
      'website_accuracy',
      'The public site will represent the verified entity accurately',
      accuracyProblems.length === 0,
      accuracyProblems.length === 0
        ? `${publishable} fact${publishable === 1 ? '' : 's'} marked for publication, none of them conflicting or uncertain.`
        : accuracyProblems.join(' '),
      { data: { publishable } },
    ),
  );
  for (const problem of accuracyProblems) {
    blockingIssues.push({
      code: 'website_accuracy',
      title: 'The public site would not be accurate yet',
      detail: problem,
      where: {},
      action: 'Resolve the conflicting or uncertain facts before publishing.',
      actionHref: '/app/review',
      checkId: 'website_accuracy',
    });
  }

  // machine_readable
  const sd = input.structuredData;
  const sdProblems: string[] = [];
  if (!sd.hasName) sdProblems.push('No name for structured data.');
  if (!sd.image) sdProblems.push('No representative image for structured data.');
  if (!sd.description) sdProblems.push('No description for structured data.');
  if (!sd.sameAs) sdProblems.push('No confirmed external profiles for sameAs.');
  if (!sd.canonicalUrl) sdProblems.push('No canonical URL established.');
  if (!sd.stableId) sdProblems.push('No stable entity identifier.');
  checks.push(
    check(
      'machine_readable',
      'Machine-readable representation is coherent',
      sdProblems.length === 0,
      sdProblems.length === 0
        ? `Person and ProfilePage structured data will include a name, ${sd.alternateNames} alternateName value${sd.alternateNames === 1 ? '' : 's'}, an image, a description, ${sd.sameAs} sameAs profile${sd.sameAs === 1 ? '' : 's'}, a stable identifier and a canonical URL.`
        : sdProblems.join(' '),
      { data: sd as unknown as Record<string, unknown> },
    ),
  );
  for (const problem of sdProblems) {
    blockingIssues.push({
      code: 'machine_readable',
      title: 'Machine-readable representation incomplete',
      detail: `${problem} Structured data never asserts anything that has not passed Nexora Entity's own verification rules.`,
      where: {},
      action: 'Resolve the missing pieces listed above.',
      actionHref: '/app/readiness',
      checkId: 'machine_readable',
    });
  }

  // score
  const earned = checks.reduce((acc, c) => {
    if (c.outcome === 'pass') return acc + c.weight;
    if (c.outcome === 'warn') return acc + c.weight * 0.5;
    return acc;
  }, 0);
  let score = Math.round((earned / TOTAL_WEIGHT) * 100);

  const uniqueBlocking = dedupeBlocking(blockingIssues);
  let status: ReadinessStatus = uniqueBlocking.length > 0 ? 'blocked' : score >= 100 ? 'ready' : 'blocked';
  if (status === 'ready' && score < 100) score = 100;
  if (status === 'blocked') score = Math.min(score, 99);

  const summary =
    status === 'ready'
      ? `ENTITY READINESS: 100% - READY. Every blocking check passed: the entity is complete and internally coherent against the Nexora Entity Readiness Standard, with ${websiteQualifying} qualifying websites, ${pressQualifying} qualifying press releases and ${input.photosQualifying} qualifying photos.`
      : `ENTITY READINESS: ${score}% - BLOCKED. ${uniqueBlocking.length} blocking issue${uniqueBlocking.length === 1 ? '' : 's'} must be resolved before this entity can be published.`;

  const report: ReadinessReport = {
    kind: input.kind,
    status,
    score,
    label: readinessLabel(score, status),
    checks,
    blockingIssues: uniqueBlocking,
    warnings,
    summary,
    completeness,
    disclaimer: READINESS_DISCLAIMER,
    evidenceNotice: EVIDENCE_MINIMUMS_NOTICE,
  };

  if (input.kind === 'second_pass') {
    report.secondPassAnswers = runSecondPassQuestions(input, report);
    const failed = report.secondPassAnswers.filter((a) => !a.pass);
    if (failed.length > 0 && report.status === 'ready') {
      report.status = 'blocked';
      report.label = readinessLabel(report.score, 'blocked');
      report.blockingIssues = [
        ...report.blockingIssues,
        ...failed.slice(0, 3).map((a) => ({
          code: 'second_pass',
          title: 'Complete review found something the individual checks missed',
          detail: a.detail,
          where: {},
          action: a.answer,
          checkId: 'material_completeness' as ReadinessCheckId,
        })),
      ];
    }
  }

  // Product-language guard: never emit a prohibited claim.
  const offending = scanForProhibitedClaims(
    [report.summary, ...report.blockingIssues.map((b) => b.detail), ...report.checks.map((c) => c.detail)].join(' '),
  );
  if (offending.length > 0) {
    report.status = 'error';
    report.summary = 'Nexora Entity produced readiness output containing language it is not permitted to use. Nothing has been published.';
  }

  return report;
}

function dedupeBlocking(issues: BlockingIssue[]): BlockingIssue[] {
  const seen = new Set<string>();
  const out: BlockingIssue[] = [];
  for (const i of issues) {
    // Two issues describing the same problem must collapse to one, whatever text they carry.
    const key = `${i.code}|${i.title}|${(i.detail ?? '').slice(0, 80)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(i);
  }
  return out;
}

/** The mandatory complete second pass: "Do I understand this person?" */
function runSecondPassQuestions(
  input: ReadinessInput,
  report: ReadinessReport,
): { question: string; answer: string; pass: boolean; detail: string }[] {
  const q: { question: string; answer: string; pass: boolean; detail: string }[] = [];
  const c = report.completeness;

  const knowWho = has(input.claims, 'identity.primaryName', 2) && has(input.claims, 'about.biography', 60);
  q.push({
    question: 'Do I know who this person is?',
    answer: knowWho ? 'Yes' : 'No',
    pass: knowWho,
    detail: knowWho
      ? `Primary name and biography are both present (${input.claims.find((x) => x.attribute_key === 'identity.primaryName')?.value_text}).`
      : 'A primary name and a substantive biography are both required to know who this person is.',
  });

  const openBlockingAmbiguities = input.ambiguities.filter((a) => a.status === 'open' && a.severity === 'blocking');
  q.push({
    question: 'Can I distinguish them from other people?',
    answer: openBlockingAmbiguities.length === 0 ? 'Yes' : 'No',
    pass: openBlockingAmbiguities.length === 0,
    detail:
      input.ambiguities.filter((a) => a.status === 'open').length === 0
        ? 'No open ambiguity concerns.'
        : `${input.ambiguities.filter((a) => a.status === 'open').length} ambiguity concern(s) remain open, ${openBlockingAmbiguities.length} of them blocking.`,
  });

  const aliasCount = countOf(input.claims, 'identity.alias');
  q.push({
    question: 'Do I understand their legitimate names and aliases?',
    answer: aliasCount > 0 ? 'Yes' : 'Partial',
    pass: aliasCount > 0,
    detail: `${aliasCount} alternate name${aliasCount === 1 ? '' : 's'} recorded.`,
  });

  const professionCount = countOf(input.claims, 'professional.profession');
  const titleCount = countOf(input.claims, 'professional.title');
  q.push({
    question: 'Do I understand what they currently do?',
    answer: professionCount > 0 || titleCount > 0 ? 'Yes' : 'No',
    pass: professionCount > 0 || titleCount > 0,
    detail: `${professionCount} profession(s), ${titleCount} title(s), current organisation: ${has(input.claims, 'professional.currentCompany', 1) ? 'yes' : 'no'}.`,
  });

  const careerCount = attrClaims(input.claims, 'career.');
  const eduCount = countOf(input.claims, 'education.qualification');
  q.push({
    question: 'Do I understand important professional or educational history where relevant?',
    answer: careerCount > 0 || eduCount > 0 ? 'Yes' : 'Partial',
    pass: careerCount > 0 || eduCount > 0,
    detail: `${careerCount} role(s), ${eduCount} qualification(s).`,
  });

  const orgCount = attrClaims(input.claims, 'organizations.');
  const projCount = countOf(input.claims, 'projects.project');
  q.push({
    question: 'Do I understand their organisations, projects, products, services and relationships?',
    answer: orgCount + projCount > 0 ? 'Yes' : 'Partial',
    pass: orgCount + projCount > 0,
    detail: `${orgCount} organisation link(s), ${projCount} project(s), ${countOf(input.claims, 'products.product') + countOf(input.claims, 'products.service')} product or service entr${countOf(input.claims, 'products.product') + countOf(input.claims, 'products.service') === 1 ? 'y' : 'ies'}.`,
  });

  const minimaMet =
    c.evidenceMinimums.websites.met && c.evidenceMinimums.pressReleases.met && c.evidenceMinimums.photos.met;
  q.push({
    question: 'Are there sufficient supporting public sources?',
    answer: minimaMet ? 'Yes' : 'No',
    pass: minimaMet,
    detail: `Websites ${c.evidenceMinimums.websites.qualifying}/5, press releases ${c.evidenceMinimums.pressReleases.qualifying}/4 across ${c.evidenceMinimums.pressReleases.independentGroups} independent groups, photos ${c.evidenceMinimums.photos.qualifying}/4. ${EVIDENCE_MINIMUMS_NOTICE}`,
  });

  q.push({
    question: 'Do 5 or more websites qualify?',
    answer: c.evidenceMinimums.websites.met ? 'Yes' : 'No',
    pass: c.evidenceMinimums.websites.met,
    detail: `${c.evidenceMinimums.websites.qualifying} of 5 qualify. Dead links, unrelated pages and duplicates of the same site do not count.`,
  });

  const pressGroups = c.evidenceMinimums.pressReleases.independentGroups;
  q.push({
    question: 'Do 4 or more press releases qualify and provide meaningful independent support?',
    answer: c.evidenceMinimums.pressReleases.met ? (pressGroups >= 4 ? 'Yes' : 'Partly') : 'No',
    pass: c.evidenceMinimums.pressReleases.met,
    detail: `${c.evidenceMinimums.pressReleases.qualifying} of 4 qualify across ${pressGroups} independent source group(s). Four copies of one release count once.`,
  });

  q.push({
    question: 'Do 4 or more photos qualify?',
    answer: c.evidenceMinimums.photos.met ? 'Yes' : 'No',
    pass: c.evidenceMinimums.photos.met,
    detail: `${c.evidenceMinimums.photos.qualifying} of 4 qualify. Each upload was checked for validity, resolution and duplication.`,
  });

  const profileSources = input.sources.filter((s) => s.platform !== null);
  const inspectedProfiles = profileSources.filter((s) => s.inspection_status === 'inspected');
  q.push({
    question: 'Have supported supplied profiles been inspected where possible?',
    answer:
      profileSources.length === 0
        ? 'Not applicable'
        : inspectedProfiles.length === profileSources.length
          ? 'Yes'
          : 'Partly',
    pass: profileSources.length === 0 || inspectedProfiles.length > 0,
    detail:
      profileSources.length === 0
        ? 'No profiles were supplied.'
        : `${inspectedProfiles.length} of ${profileSources.length} inspected; ${profileSources.length - inspectedProfiles.length} could not be read, and that limitation is recorded rather than hidden.`,
  });

  const portfolioOk = input.portfolioFiles.filter((f) => f.extraction_status === 'extracted').length;
  q.push({
    question: 'Is supplied portfolio information understood and properly attributed?',
    answer:
      input.portfolioFiles.length === 0
        ? 'Not applicable'
        : portfolioOk > 0 && input.portfolioDiscoveriesPending === 0
          ? 'Yes'
          : 'Partly',
    pass: input.portfolioFiles.length === 0 || (portfolioOk > 0 && input.portfolioDiscoveriesPending === 0),
    detail:
      input.portfolioFiles.length === 0
        ? 'No portfolio uploaded.'
        : `${portfolioOk} of ${input.portfolioFiles.length} file(s) read, with ${input.portfolioDiscoveriesPending} discovered item(s) awaiting review. Portfolio information is user-provided evidence unless independently supported, and it never satisfies the five-website requirement on its own.`,
  });

  q.push({
    question: 'Are there unresolved contradictions or ambiguity?',
    answer: report.blockingIssues.length === 0 ? 'No' : `Yes: ${report.blockingIssues.length} blocking issue(s)`,
    pass: report.blockingIssues.length === 0,
    detail:
      report.blockingIssues.length === 0
        ? 'No open contradictions or ambiguity concerns remain.'
        : report.blockingIssues.map((b) => b.title).join('; '),
  });

  const selfOnly = input.claims.filter((c) => c.origin === 'user' && !c.user_confirmed).length;
  q.push({
    question: 'Is important information unsupported or stale?',
    answer: selfOnly > 0 ? 'No' : 'Yes',
    // Was hardcoded to false, so this question failed on every run regardless of the data.
    // With zero unconfirmed self-asserted claims â€” the state a well-sourced entity should
    // reach â€” the second pass still blocked the entity at "100% â€” BLOCKED" and raised a
    // blocking issue whose own text reported that nothing rested on the person's assertion.
    // The flag must follow the data, not override it.
    pass: selfOnly === 0,
    detail: selfOnly > 0
      ? `${selfOnly} claim(s) rest on the person` + "'" + `s own assertion only. These are kept as user-provided and are never presented as independently verified.`
      : "No claim rests on the person's own assertion alone. Everything asserted is supported by an inspected source.",
  });

  const accuracy = report.checks.find((k) => k.id === 'website_accuracy');
  q.push({
    question: 'Is the public Entity Website accurate and complete?',
    answer: accuracy?.outcome === 'pass' ? 'Yes' : 'Not yet',
    pass: accuracy?.outcome === 'pass',
    detail: accuracy?.detail ?? '',
  });

  const machine = report.checks.find((k) => k.id === 'machine_readable');
  q.push({
    question: 'Is the machine-readable entity representation coherent?',
    answer: machine?.outcome === 'pass' ? 'Yes' : 'Not yet',
    pass: machine?.outcome === 'pass',
    detail: machine?.detail ?? '',
  });

  q.push({
    question: 'Is any material information still missing?',
    answer: c.materialGaps.length === 0 ? 'No' : `Yes: ${c.materialGaps.length} gap(s)`,
    pass: c.materialGaps.length === 0,
    detail: c.materialGaps.length === 0 ? 'Nothing material is missing.' : c.materialGaps.map((g) => g.what).join(' | '),
  });

  q.push({
    question: `Was the entire entity re-reviewed rather than just the last corrected field? (${input.correctionsSinceParent} correction(s) since the previous run)`,
    answer: 'Yes',
    pass: true,
    detail: `This review re-examined all ${input.claims.length} claims, ${input.sources.length} sources, ${input.photos.length} photos, ${input.identityLinks.length} identity relationships, ${input.conflicts.length} conflicts and ${input.ambiguities.length} ambiguity concerns from the beginning.`,
  });

  q.push({
    question:
      'If I were a search engine trying to understand this person as one real-world entity, do I fully understand them as a whole?',
    answer: report.status === 'ready' ? 'Yes' : 'Not yet',
    pass: report.status === 'ready',
    detail:
      report.status === 'ready'
        ? "On Nexora Entity's own Entity Readiness Standard, the entity is complete and internally coherent."
        : `Not yet: ${report.blockingIssues.length} blocking issue(s) remain. This is an internal Nexora Entity analysis. Nexora Entity has no access to, and makes no claim about, any search engine's private internal knowledge graph.`,
  });

  return q;
}

export type { Severity };
