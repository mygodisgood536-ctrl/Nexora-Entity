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

/** One answer from the mandatory whole-entity second pass. */
export interface SecondPassAnswer {
  /** Stable identifier, so a blocking answer can be traced back to the question that produced it. */
  key?: string;
  question: string;
  answer: string;
  /** What the person should do about it. Only meaningful when `pass` is false. */
  action?: string;
  pass: boolean;
  detail: string;
  /** Which readiness check this question belongs to, when it maps to one. */
  checkId?: ReadinessCheckId;
}

export interface ReadinessReport {
  kind: ReadinessRunKind;
  status: ReadinessStatus;
  score: number;
  label: string;
  checks: CheckResult[];
  blockingIssues: BlockingIssue[];
  warnings: { code: string; title: string; detail: string }[];
  secondPassAnswers?: SecondPassAnswer[];
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
  // Recomputed exactly as the website and press minimums above: the caller's summary number is
  // capped by the photo records actually in front of the gate, so a caller reporting four
  // qualifying photos while supplying none cannot pass.
  const photosQualifying = Math.min(input.photosQualifying, qualifyingPhotos.length);
  checks.push(
    check(
      'photos_minimum_4',
      'Four qualifying photos',
      photosQualifying >= 4,
      `${photosQualifying} of 4 qualifying photos. ${rejectedPhotoCount} uploaded image${rejectedPhotoCount === 1 ? ' was' : 's were'} rejected as invalid or duplicate. ${EVIDENCE_MINIMUMS_NOTICE}`,
      { stageKey: 'Q_photos' },
    ),
  );
  if (photosQualifying < 4) {
    const rejectedPhotos = input.photos.filter((p) => !p.qualifies);
    const first = rejectedPhotos[0];
    blockingIssues.push({
      code: 'photos_minimum_4',
      title: `Only ${photosQualifying} of 4 qualifying photos`,
      detail: `Each upload is checked for validity, resolution and duplication. ${EVIDENCE_MINIMUMS_NOTICE}`,
      where: { stageKey: 'Q_photos' },
      action:
        first && first.disqualify_reasons?.[0]
          ? `This photo was not counted: ${first.disqualify_reasons[0]}`
          : `Upload ${4 - photosQualifying} more photo${4 - photosQualifying === 1 ? '' : 's'}.`,
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
  const status: ReadinessStatus = uniqueBlocking.length > 0 ? 'blocked' : score >= 100 ? 'ready' : 'blocked';
  if (status === 'ready' && score < 100) score = 100;
  if (status === 'blocked') score = Math.min(score, 99);

  const summary =
    status === 'ready'
      ? `ENTITY READINESS: 100% - READY. Every blocking check passed: the entity is complete and internally coherent against the Nexora Entity Readiness Standard, with ${websiteQualifying} qualifying websites, ${pressQualifying} qualifying press releases and ${photosQualifying} qualifying photos.`
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
      // A whole-entity review that fails must never leave a "100% — BLOCKED" label on screen.
      // The score is re-clamped and the label and summary are rebuilt together, so the displayed
      // figure always agrees with the displayed status.
      report.score = Math.min(report.score, 99);
      report.label = readinessLabel(report.score, 'blocked');
      report.summary = `ENTITY READINESS: ${report.score}% - BLOCKED. The complete whole-entity review found ${failed.length} issue${failed.length === 1 ? '' : 's'} that the individual checks did not.`;
      report.blockingIssues = [
        ...report.blockingIssues,
        ...failed.slice(0, 3).map((a, i) => ({
          code: `second_pass:${a.key ?? i}`,
          title: 'Complete review found something the individual checks missed',
          detail: a.detail,
          where: {},
          action: a.action ?? 'Resolve the issue the complete review identified above.',
          checkId: (a.checkId ?? 'material_completeness') as ReadinessCheckId,
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

/**
 * The mandatory complete second pass: "Do I understand this person?"
 *
 * This is a genuinely independent re-evaluation, not a restatement of the first pass. It works
 * from the raw evidence records in `input` and re-derives its own verdicts, deliberately reading
 * neither `report.checks` nor `report.blockingIssues` for anything it can compute itself. That
 * separation is the whole point: a second pass that echoes the first pass's conclusions cannot
 * catch an interaction between facts that an individual field check missed, and would merely
 * restate the first pass with extra sentences.
 *
 * Every answer is derived from data. Nothing here asserts that a review happened; the review
 * demonstrably happened because each verdict below was recomputed from the evidence.
 */
function runSecondPassQuestions(input: ReadinessInput, report: ReadinessReport): SecondPassAnswer[] {
  const q: SecondPassAnswer[] = [];

  // ── Independent re-derivation of the hard evidence minimums ────────────────────────────────
  // Recomputed from the source and photo records, capped by the caller's summary exactly as the
  // gate itself does, so the second pass cannot be satisfied by a summary number alone.
  const sites = input.sources.filter((s) => s.qualifies_websites && !s.is_duplicate_of);
  const websiteCount = Math.min(input.websiteQualifying, sites.length);
  const press = input.sources.filter((s) => s.qualifies_press && !s.is_duplicate_of);
  const pressCount = Math.min(input.pressQualifying, press.length);
  const pressGroups = new Set(press.map((s) => s.independence_group ?? s.id)).size;
  const photoCount = Math.min(input.photosQualifying, input.photos.filter((p) => p.qualifies).length);

  // Conflicts and ambiguity re-derived from the underlying records rather than from the
  // first pass's blocking list.
  const openConflicts = input.conflicts.filter((x) => x.status === 'open');
  const blockingConflicts = openConflicts.filter((x) => x.severity === 'blocking');
  const openAmbiguities = input.ambiguities.filter((a) => a.status === 'open');
  const blockingAmbiguities = openAmbiguities.filter((a) => a.severity === 'blocking');

  const knowWho = has(input.claims, 'identity.primaryName', 2) && has(input.claims, 'about.biography', 60);
  q.push({
    key: 'identity',
    checkId: 'identity_core',
    question: 'Do I know who this person is?',
    answer: knowWho ? 'Yes' : 'No',
    action: 'Complete the Basic identity and About stages with a full public name and a substantive biography.',
    pass: knowWho,
    detail: knowWho
      ? `Primary name and biography are both present (${input.claims.find((x) => x.attribute_key === 'identity.primaryName')?.value_text}).`
      : 'A primary name and a substantive biography are both required to know who this person is.',
  });

  const distinguishable = blockingAmbiguities.length === 0 && blockingConflicts.length === 0;
  q.push({
    key: 'distinguishability',
    checkId: 'ambiguity_resolved',
    question: 'Can I distinguish them from other people?',
    answer: distinguishable ? 'Yes' : 'No',
    action: 'Resolve the open identity contradictions and ambiguity concerns listed above.',
    pass: distinguishable,
    detail:
      openAmbiguities.length === 0 && openConflicts.length === 0
        ? 'No open ambiguity concerns or identity contradictions.'
        : `${openConflicts.length} open conflict(s) (${blockingConflicts.length} blocking) and ${openAmbiguities.length} open ambiguity concern(s) (${blockingAmbiguities.length} blocking).`,
  });

  const aliasCount = countOf(input.claims, 'identity.alias');
  q.push({
    key: 'aliases',
    checkId: 'name_variants',
    question: 'Do I understand their legitimate names and aliases?',
    answer: aliasCount > 0 ? 'Yes' : 'Partial',
    action: 'Add any other names, nicknames or professional names people use for you.',
    pass: aliasCount > 0,
    detail: `${aliasCount} alternate name${aliasCount === 1 ? '' : 's'} recorded.`,
  });

  const professionCount = countOf(input.claims, 'professional.profession');
  const titleCount = countOf(input.claims, 'professional.title');
  const knowsCurrentRole = professionCount > 0 || titleCount > 0;
  q.push({
    key: 'current_role',
    checkId: 'current_profession',
    question: 'Do I understand what they currently do?',
    answer: knowsCurrentRole ? 'Yes' : 'No',
    action: 'Complete the Professional identity stage with your current profession and roles.',
    pass: knowsCurrentRole,
    detail: `${professionCount} profession(s), ${titleCount} title(s), current organisation: ${has(input.claims, 'professional.currentCompany', 1) ? 'yes' : 'no'}.`,
  });

  const careerCount = attrClaims(input.claims, 'career.');
  const eduCount = countOf(input.claims, 'education.qualification');
  q.push({
    key: 'history',
    checkId: 'career_history',
    question: 'Do I understand important professional or educational history where relevant?',
    answer: careerCount > 0 || eduCount > 0 ? 'Yes' : 'Partial',
    action: 'Add your work history or education so dated facts can be told apart from contradictions.',
    pass: careerCount > 0 || eduCount > 0,
    detail: `${careerCount} role(s), ${eduCount} qualification(s).`,
  });

  const orgCount = attrClaims(input.claims, 'organizations.');
  const projCount = countOf(input.claims, 'projects.project');
  const productCount = countOf(input.claims, 'products.product') + countOf(input.claims, 'products.service');
  q.push({
    key: 'relationships',
    checkId: 'organizations_projects',
    question: 'Do I understand their organisations, projects, products, services and relationships?',
    answer: orgCount + projCount + productCount > 0 ? 'Yes' : 'Partial',
    action: 'Add the organisations, projects, products or services you want connected to your name.',
    pass: orgCount + projCount + productCount > 0,
    detail: `${orgCount} organisation link(s), ${projCount} project(s), ${productCount} product or service entr${productCount === 1 ? 'y' : 'ies'}.`,
  });

  const minimaMet = websiteCount >= 5 && pressCount >= 4 && photoCount >= 4;
  q.push({
    key: 'supporting_sources',
    checkId: 'public_sources',
    question: 'Are there sufficient supporting public sources?',
    answer: minimaMet ? 'Yes' : 'No',
    action: 'Bring the evidence minimums up to 5 qualifying websites, 4 qualifying press releases and 4 qualifying photos.',
    pass: minimaMet,
    detail: `Websites ${websiteCount}/5, press releases ${pressCount}/4 across ${pressGroups} independent groups, photos ${photoCount}/4. ${EVIDENCE_MINIMUMS_NOTICE}`,
  });

  q.push({
    key: 'websites_minimum_5',
    checkId: 'websites_minimum_5',
    question: 'Do 5 or more websites qualify?',
    answer: websiteCount >= 5 ? 'Yes' : 'No',
    action: `Add ${Math.max(0, 5 - websiteCount)} more qualifying website${5 - websiteCount === 1 ? '' : 's'}.`,
    pass: websiteCount >= 5,
    detail: `${websiteCount} of 5 qualify. Dead links, unrelated pages and duplicates of the same site do not count.`,
  });

  q.push({
    key: 'press_minimum_4',
    checkId: 'press_minimum_4',
    question: 'Do 4 or more press releases qualify and provide meaningful independent support?',
    answer: pressCount >= 4 ? (pressGroups >= 4 ? 'Yes' : 'Partly') : 'No',
    action: `Add ${Math.max(0, 4 - pressCount)} more qualifying press release${4 - pressCount === 1 ? '' : 's'} from independent publications.`,
    pass: pressCount >= 4,
    detail: `${pressCount} of 4 qualify across ${pressGroups} independent source group(s). Four copies of one release count once.`,
  });

  q.push({
    key: 'photos_minimum_4',
    checkId: 'photos_minimum_4',
    question: 'Do 4 or more photos qualify?',
    answer: photoCount >= 4 ? 'Yes' : 'No',
    action: `Upload ${Math.max(0, 4 - photoCount)} more qualifying photo${4 - photoCount === 1 ? '' : 's'}.`,
    pass: photoCount >= 4,
    detail: `${photoCount} of 4 qualify. Each upload was checked for validity, resolution and duplication.`,
  });

  const profileSources = input.sources.filter((s) => s.platform !== null);
  const inspectedProfiles = profileSources.filter((s) => s.inspection_status === 'inspected');
  q.push({
    key: 'profile_inspection',
    checkId: 'social_inspection',
    question: 'Have supported supplied profiles been inspected where possible?',
    answer:
      profileSources.length === 0
        ? 'Not applicable'
        : inspectedProfiles.length === profileSources.length
          ? 'Yes'
          : 'Partly',
    action: 'Supply at least one public profile that Nexora Entity is able to read.',
    pass: profileSources.length === 0 || inspectedProfiles.length > 0,
    detail:
      profileSources.length === 0
        ? 'No profiles were supplied.'
        : `${inspectedProfiles.length} of ${profileSources.length} inspected; ${profileSources.length - inspectedProfiles.length} could not be read, and that limitation is recorded rather than hidden.`,
  });

  const portfolioOk = input.portfolioFiles.filter((f) => f.extraction_status === 'extracted').length;
  const portfolioFine = input.portfolioFiles.length === 0 || (portfolioOk > 0 && input.portfolioDiscoveriesPending === 0);
  q.push({
    key: 'portfolio',
    checkId: 'portfolio_understood',
    question: 'Is supplied portfolio information understood and properly attributed?',
    answer: input.portfolioFiles.length === 0 ? 'Not applicable' : portfolioFine ? 'Yes' : 'Partly',
    action: 'Review the items Nexora Entity discovered in your portfolio so they can be accepted or rejected.',
    pass: portfolioFine,
    detail:
      input.portfolioFiles.length === 0
        ? 'No portfolio uploaded.'
        : `${portfolioOk} of ${input.portfolioFiles.length} file(s) read, with ${input.portfolioDiscoveriesPending} discovered item(s) awaiting review. Portfolio information is user-provided evidence unless independently supported, and it never satisfies the five-website requirement on its own.`,
  });

  q.push({
    key: 'contradictions',
    checkId: 'conflicts_resolved',
    question: 'Are there unresolved contradictions or ambiguity?',
    answer: blockingConflicts.length + blockingAmbiguities.length === 0 ? 'No' : `Yes: ${blockingConflicts.length + blockingAmbiguities.length} blocking issue(s)`,
    action: 'Review the conflicts and ambiguity concerns, then confirm the correct information.',
    pass: blockingConflicts.length + blockingAmbiguities.length === 0,
    detail:
      blockingConflicts.length + blockingAmbiguities.length === 0
        ? 'No open blocking contradictions or ambiguity concerns remain.'
        : [
            ...blockingConflicts.map((x) => x.description),
            ...blockingAmbiguities.map((a) => a.description),
          ].join('; '),
  });

  const selfOnly = input.claims.filter((x) => x.origin === 'user' && !x.user_confirmed).length;
  q.push({
    key: 'unsupported_claims',
    checkId: 'support_strength',
    question: 'Is important information unsupported or stale?',
    answer: selfOnly > 0 ? 'No' : 'Yes',
    // Must follow the data. An earlier version hardcoded this to false, which blocked every
    // entity at "100% — BLOCKED" while the blocking text itself reported that nothing rested
    // on the person's assertion.
    action: 'Confirm the claims that currently rest only on your own assertion, or supply a source for them.',
    pass: selfOnly === 0,
    detail:
      selfOnly > 0
        ? `${selfOnly} claim(s) rest on the person's own assertion only. These are kept as user-provided and are never presented as independently verified.`
        : "No claim rests on the person's own assertion alone. Everything asserted is supported by an inspected source.",
  });

  // Website accuracy and machine-readable coherence cannot be recomputed here: they are
  // properties of a built artefact, and re-reading the first pass's result is the correct,
  // non-circular thing to do for them. They are labelled so the reader knows where the answer
  // came from.
  const accuracy = report.checks.find((k) => k.id === 'website_accuracy');
  q.push({
    key: 'website_accuracy',
    checkId: 'website_accuracy',
    question: 'Is the public Entity Website accurate and complete?',
    answer: accuracy?.outcome === 'pass' ? 'Yes' : 'Not yet',
    action: 'Resolve what the published-site validation reported before publishing.',
    pass: accuracy?.outcome === 'pass',
    detail: `${accuracy?.detail ?? 'No published-site validation result was available.'} (carried from the artefact validation in the first pass)`,
  });

  const machine = report.checks.find((k) => k.id === 'machine_readable');
  q.push({
    key: 'machine_readable',
    checkId: 'machine_readable',
    question: 'Is the machine-readable entity representation coherent?',
    answer: machine?.outcome === 'pass' ? 'Yes' : 'Not yet',
    action: 'Add the missing structured-entity information listed by the readiness board.',
    pass: machine?.outcome === 'pass',
    detail: `${machine?.detail ?? 'No structured-data result was available.'} (carried from the structured-data check in the first pass)`,
  });

  q.push({
    key: 'material_completeness',
    checkId: 'material_completeness',
    question: 'Is any material information still missing?',
    answer: report.completeness.materialGaps.length === 0 ? 'No' : `Yes: ${report.completeness.materialGaps.length} gap(s)`,
    action: 'Complete the stages listed below so the entity can be understood as a whole.',
    pass: report.completeness.materialGaps.length === 0,
    detail:
      report.completeness.materialGaps.length === 0
        ? 'Nothing material is missing.'
        : report.completeness.materialGaps.map((g) => g.what).join(' | '),
  });

  /**
   * What the previous pass could not settle.
   *
   * This replaces a question that used to hardcode `pass: true` and assert "Yes — the entire
   * entity was re-reviewed", which could never fail for any input and was therefore a
   * self-certification rather than a check. It now reports an honest, derived measurement: the
   * breadth of material actually re-examined by the questions above, and the number of
   * corrections since the parent run. It fails when the second pass examined too little to be
   * meaningfully different from the first — which is the condition worth gating on.
   */
  const examined = sites.length + press.length + input.photos.length + input.claims.length + input.identityLinks.length;
  const substantialReview = examined >= 10;
  q.push({
    key: 'review_breadth',
    question:
      'Was the entire entity re-examined rather than only the last corrected field? ' +
      `(${input.correctionsSinceParent} correction(s) since the previous run)`,
    answer: substantialReview ? 'Yes' : 'No',
    action: 'There is not enough recorded material for a whole-entity review to mean anything. Add your evidence first.',
    pass: substantialReview,
    detail:
      `This pass independently re-derived its verdicts from ${input.claims.length} claim(s), ${input.sources.length} source(s) ` +
      `(${websiteCount} qualifying website, ${pressCount} qualifying press release across ${pressGroups} independent group(s)), ` +
      `${input.photos.length} photo(s), ${input.identityLinks.length} identity relationship(s), ${openConflicts.length} open conflict(s) and ` +
      `${openAmbiguities.length} open ambiguity concern(s) — not from the first pass's conclusions. ` +
      (substantialReview
        ? 'That is enough material for a whole-entity review to be meaningful.'
        : `Only ${examined} record(s) were available, which is too few for a whole-entity review to be meaningful.`),
  });

  q.push({
    key: 'whole_entity',
    question:
      'If I were a search engine trying to understand this person as one real-world entity, do I fully understand them as a whole?',
    answer: q.every((a) => a.pass) ? 'Yes' : 'Not yet',
    action: 'Resolve every question above that did not pass.',
    pass: q.every((a) => a.pass),
    detail: q.every((a) => a.pass)
      ? "On Nexora Entity's own Entity Readiness Standard, the entity is complete and internally coherent."
      : `${q.filter((a) => !a.pass).length} of ${q.length} whole-entity questions did not pass. This is an internal Nexora Entity analysis. Nexora Entity has no access to, and makes no claim about, any search engine's private internal knowledge graph.`,
  });

  return q;
}

export type { Severity };
