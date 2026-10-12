/**
 * Completeness reasoning (Amendment sections 3 and 7).
 *
 * After stages are completed or skipped, the platform reasons over the whole entity and asks:
 * "If I were trying to understand this person as one real-world entity, do I understand the
 * important parts of who they are, what they do, how their sources connect to them, and how to
 * distinguish them from other people?"
 *
 * It distinguishes three kinds of missing information:
 *   - optional (a field simply exists),
 *   - hard Nexora Entity evidence minimums,
 *   - genuinely material (without it the person cannot be understood).
 *
 * A material gap names what is missing, why it matters, and which stage completes it.
 */

import { EVIDENCE_MINIMUMS, STAGE_BY_KEY, StageRequirement, type StageKey, type StageStatus } from '@nexora/core';
import type { ClaimRecord, PhotoRecord, SourceRecord, StageProgressRecord } from '@nexora/db';

export interface CompletenessInput {
  stages: StageProgressRecord[];
  claims: ClaimRecord[];
  sources: SourceRecord[];
  photos: PhotoRecord[];
  portfolioFiles: { extraction_status: string }[];
  websiteQualifying: number;
  pressQualifying: number;
  photosQualifying: number;
  independentPressGroups: number;
}

export interface MaterialGap {
  id: string;
  stageKey: StageKey | null;
  /** What is missing, in plain language. */
  what: string;
  /** Why it materially matters. */
  why: string;
  severity: 'blocking' | 'recommended';
  category: 'identity' | 'understanding' | 'evidence_minimum' | 'distinguishability' | 'representation';
  href: string;
}

export interface CompletenessResult {
  /** 0..1 - how completely the entity can be understood. */
  coverage: number;
  materialGaps: MaterialGap[];
  optionalGaps: MaterialGap[];
  evidenceMinimums: {
    websites: { required: number; qualifying: number; met: boolean };
    pressReleases: { required: number; qualifying: number; met: boolean; independentGroups: number };
    photos: { required: number; qualifying: number; met: boolean };
  };
  /** One-paragraph, plain-language explanation used in the interface. */
  narrative: string;
}

const EVIDENCE_NOTE =
  'These are Nexora Entity internal evidence requirements for describing a real person across the web. They are not requirements imposed by Google or any other search engine.';

const stageHref = (k: StageKey): string => `/app/stages/${k}`;

function hasClaim(claims: ClaimRecord[], key: string, minLength = 1): boolean {
  return claims.some((c) => c.attribute_key === key && c.value_text.trim().length >= minLength);
}

function claimCount(claims: ClaimRecord[], key: string): number {
  return claims.filter((c) => c.attribute_key === key && c.value_text.trim().length > 0).length;
}

function anyClaimsWithPrefix(claims: ClaimRecord[], prefix: string): number {
  return claims.filter((c) => c.attribute_key.startsWith(prefix) && c.value_text.trim().length > 0).length;
}

function stageStatus(stages: StageProgressRecord[], key: StageKey): StageStatus {
  return stages.find((s) => s.stage_key === key)?.status ?? 'pending';
}

export function evaluateCompleteness(input: CompletenessInput): CompletenessResult {
  const { claims, stages, sources, portfolioFiles } = input;
  const materialGaps: MaterialGap[] = [];
  const optionalGaps: MaterialGap[] = [];

  // 1. Identity core (material)
  if (!hasClaim(claims, 'identity.primaryName', 2)) {
    materialGaps.push({
      id: 'primary_name',
      stageKey: 'A_identity',
      what: 'The name you are publicly known by.',
      why: 'Everything else connects to your name. Without it there is nothing for your sources to attach to.',
      severity: 'blocking',
      category: 'identity',
      href: stageHref('A_identity'),
    });
  }

  // 2. Biography (material)
  if (!hasClaim(claims, 'about.biography', 60)) {
    materialGaps.push({
      id: 'biography',
      stageKey: 'C_about',
      what: 'A biography of at least a sentence or two.',
      why: 'A biography is what lets a reader, and a search engine, understand the person behind the name rather than a list of keywords.',
      severity: 'blocking',
      category: 'understanding',
      href: stageHref('C_about'),
    });
  }

  // 3. Current professional identity (material)
  const professions = claimCount(claims, 'professional.profession');
  const currentCompany = hasClaim(claims, 'professional.currentCompany', 1);
  const titles = claimCount(claims, 'professional.title');
  if (professions === 0 && titles === 0 && !currentCompany) {
    materialGaps.push({
      id: 'current_profession',
      stageKey: 'D_professional_identity',
      what: 'What you currently do.',
      why: 'A current role is one of the strongest signals tying your sources to you, and one of the most common sources of contradiction.',
      severity: 'blocking',
      category: 'understanding',
      href: stageHref('D_professional_identity'),
    });
  }

  // 4. Distinguishability (material)
  const aliasCount = claimCount(claims, 'identity.alias');
  const orgCount = anyClaimsWithPrefix(claims, 'organizations.');
  const careerCount = claimCount(claims, 'career.role');
  const locationCount = anyClaimsWithPrefix(claims, 'location.') > 0 || hasClaim(claims, 'identity.location', 1);
  const distinguishingCount = [aliasCount > 0, orgCount > 0, careerCount > 0, locationCount, professions > 0].filter(
    Boolean,
  ).length;
  if (distinguishingCount < 2) {
    const missing: string[] = [];
    if (aliasCount === 0) missing.push('other names people use for you');
    if (orgCount === 0 && careerCount === 0) missing.push('an organisation or role you are connected to');
    if (!locationCount) missing.push('where you are or have been');
    const stage: StageKey = aliasCount === 0 ? 'B_name_variants' : orgCount === 0 ? 'H_organizations' : 'T_location';
    materialGaps.push({
      id: 'distinguishability',
      stageKey: stage,
      what: missing.length ? `${missing.join(', ')}.` : 'More information that tells you apart from other people with the same name.',
      why: 'Right now someone could not reliably tell you apart from another person with a similar name. Nexora Entity will not publish an entity it cannot distinguish.',
      severity: 'blocking',
      category: 'distinguishability',
      href: stageHref(stage),
    });
  }

  // 5. Hard internal evidence minimums
  const min: CompletenessResult['evidenceMinimums'] = {
    websites: {
      required: EVIDENCE_MINIMUMS.websites.required,
      qualifying: input.websiteQualifying,
      met: input.websiteQualifying >= EVIDENCE_MINIMUMS.websites.required,
    },
    pressReleases: {
      required: EVIDENCE_MINIMUMS.pressReleases.required,
      qualifying: input.pressQualifying,
      met: input.pressQualifying >= EVIDENCE_MINIMUMS.pressReleases.required,
      independentGroups: input.independentPressGroups,
    },
    photos: {
      required: EVIDENCE_MINIMUMS.photos.required,
      qualifying: input.photosQualifying,
      met: input.photosQualifying >= EVIDENCE_MINIMUMS.photos.required,
    },
  };

  const sitesMissing = min.websites.required - input.websiteQualifying;
  if (!min.websites.met) {
    materialGaps.push({
      id: 'min_websites',
      stageKey: 'N_websites',
      what: `${sitesMissing} more qualifying live website${sitesMissing === 1 ? '' : 's'} (${input.websiteQualifying} of ${min.websites.required} so far).`,
      why: `Each site is checked for reachability and whether it is genuinely about you, so dead links, unrelated pages and copies of the same site do not count. ${EVIDENCE_NOTE}`,
      severity: 'blocking',
      category: 'evidence_minimum',
      href: stageHref('N_websites'),
    });
  }

  const pressMissing = min.pressReleases.required - input.pressQualifying;
  if (!min.pressReleases.met) {
    materialGaps.push({
      id: 'min_press',
      stageKey: 'M_press_releases',
      what: `${pressMissing} more qualifying press release${pressMissing === 1 ? '' : 's'} (${input.pressQualifying} of ${min.pressReleases.required} so far).`,
      why: `Independent published coverage is the strongest public evidence that a person is who they say they are. Nexora Entity counts independent coverage only: four websites copying one release count as one. ${EVIDENCE_NOTE}`,
      severity: 'blocking',
      category: 'evidence_minimum',
      href: stageHref('M_press_releases'),
    });
  }

  const photosMissing = min.photos.required - input.photosQualifying;
  if (!min.photos.met) {
    materialGaps.push({
      id: 'min_photos',
      stageKey: 'Q_photos',
      what: `${photosMissing} more qualifying photo${photosMissing === 1 ? '' : 's'} (${input.photosQualifying} of ${min.photos.required} so far).`,
      why: `Photographs are how a person is represented visually. Uploads are checked for validity and duplication. ${EVIDENCE_NOTE}`,
      severity: 'blocking',
      category: 'evidence_minimum',
      href: stageHref('Q_photos'),
    });
  }

  // 6. At least one readable source (material)
  const inspectedSources = sources.filter((s) => s.inspection_status === 'inspected');
  if (inspectedSources.length === 0) {
    materialGaps.push({
      id: 'no_inspected_sources',
      stageKey: 'P_social_profiles',
      what: 'At least one public profile or website for Nexora Entity to read.',
      why: 'Without a readable source there is nothing to check your information against, and no way to tell your sources apart from someone else.',
      severity: 'blocking',
      category: 'understanding',
      href: stageHref('P_social_profiles'),
    });
  }

  // 7. Website coverage (material)
  if (claimCount(claims, 'websites.website') === 0) {
    materialGaps.push({
      id: 'no_websites',
      stageKey: 'N_websites',
      what: 'Websites that represent you online.',
      why: 'Your public site is built from these, and they are the anchors other sources are checked against.',
      severity: 'blocking',
      category: 'representation',
      href: stageHref('N_websites'),
    });
  }

  // 8. Optional / recommended (never blocking)
  const recommended: { key: StageKey; id: string; what: string; why: string; claimKey: string }[] = [
    { key: 'E_career', id: 'career_history', what: 'A dated work history.', why: 'Dates let Nexora Entity tell a career change apart from a contradiction.', claimKey: 'career.role' },
    { key: 'F_education', id: 'education', what: 'Education or qualifications.', why: 'Education is a strong distinguishing signal between people with similar names.', claimKey: 'education.qualification' },
    { key: 'G_skills', id: 'skills', what: 'Skills and areas of expertise.', why: 'Skills connect you to your work and to organisations.', claimKey: 'skills.skill' },
    { key: 'H_organizations', id: 'organizations', what: 'Organisations you are affiliated with.', why: 'Affiliations connect you to projects and to other people.', claimKey: 'organizations.affiliation' },
    { key: 'I_projects', id: 'projects', what: 'Projects you have built.', why: 'Projects are the clearest evidence of what a person actually did.', claimKey: 'projects.project' },
    { key: 'J_products_services', id: 'products', what: 'Products or services you deliver.', why: 'Products connect you to organisations and to the people who use them.', claimKey: 'products.product' },
    { key: 'K_achievements', id: 'achievements', what: 'Achievements and recognition.', why: 'Recognition from independent bodies is among the strongest evidence.', claimKey: 'achievements.achievement' },
    { key: 'L_publications_media', id: 'publications', what: 'Publications, interviews or media you created.', why: 'Work you produced is primary evidence, distinct from press about you.', claimKey: 'publications.item' },
    { key: 'O_portfolio', id: 'portfolio', what: 'A portfolio.', why: 'A portfolio is strong first-party material. It does not replace the five-website minimum.', claimKey: 'portfolio.document' },
    { key: 'S_public_contact', id: 'contact', what: 'Public contact details.', why: 'Only if you want them published. Entirely your choice.', claimKey: 'contact.email' },
  ];
  for (const r of recommended) {
    if (claimCount(claims, r.claimKey) === 0 && stageStatus(stages, r.key) !== 'complete') {
      optionalGaps.push({
        id: r.id,
        stageKey: r.key,
        what: r.what,
        why: r.why,
        severity: 'recommended',
        category: 'understanding',
        href: stageHref(r.key),
      });
    }
  }

  const portfolioExtracted = portfolioFiles.filter((f) => f.extraction_status === 'extracted').length;
  const projectsOrProducts =
    claimCount(claims, 'projects.project') + claimCount(claims, 'products.product') + claimCount(claims, 'products.service');
  const organisations = anyClaimsWithPrefix(claims, 'organizations.');
  const achievements = claimCount(claims, 'achievements.achievement');
  const career = anyClaimsWithPrefix(claims, 'career.');
  const education = claimCount(claims, 'education.qualification');

  const dimensions = [
    { name: 'identity', met: hasClaim(claims, 'identity.primaryName', 2), weight: 1.2 },
    { name: 'biography', met: hasClaim(claims, 'about.biography', 60), weight: 1.1 },
    { name: 'profession', met: professions > 0 || titles > 0 || currentCompany, weight: 1.1 },
    { name: 'distinguishability', met: distinguishingCount >= 2, weight: 1.2 },
    { name: 'websites minimum', met: min.websites.met, weight: 1.3 },
    { name: 'press minimum', met: min.pressReleases.met, weight: 1.2 },
    { name: 'photos minimum', met: min.photos.met, weight: 1 },
    { name: 'inspected sources', met: inspectedSources.length > 0, weight: 0.9 },
    { name: 'career history', met: career > 0, weight: 0.5 },
    { name: 'education', met: education > 0, weight: 0.4 },
    { name: 'organizations', met: organisations > 0, weight: 0.5 },
    { name: 'projects', met: projectsOrProducts > 0, weight: 0.5 },
    { name: 'achievements', met: achievements > 0, weight: 0.4 },
    { name: 'portfolio', met: portfolioExtracted > 0, weight: 0.3 },
  ];
  const totalWeight = dimensions.reduce((a, d) => a + d.weight, 0);
  const earned = dimensions.filter((d) => d.met).reduce((a, d) => a + d.weight, 0);
  const coverage = Math.round((earned / totalWeight) * 100) / 100;

  return {
    coverage,
    materialGaps,
    optionalGaps,
    evidenceMinimums: min,
    narrative: buildNarrative({ coverage, materialGaps, min }),
  };
}

function buildNarrative(input: {
  coverage: number;
  materialGaps: MaterialGap[];
  min: CompletenessResult['evidenceMinimums'];
}): string {
  const pct = Math.round(input.coverage * 100);
  if (input.materialGaps.length === 0) {
    return (
      `Nexora Entity understands ${pct}% of this person's entity and has no material gaps. ` +
      `Your evidence minimums are met: ${input.min.websites.qualifying} qualifying websites, ` +
      `${input.min.pressReleases.qualifying} qualifying press releases across ` +
      `${input.min.pressReleases.independentGroups} independent sources, and ` +
      `${input.min.photos.qualifying} qualifying photos.`
    );
  }
  const first = input.materialGaps[0];
  const remaining = input.materialGaps.length - 1;
  const lead = first ? `The most important gap: ${first.what} ${first.why} ` : '';
  const tail =
    remaining > 0
      ? `There ${remaining === 1 ? 'is 1 more material gap' : `are ${remaining} more material gaps`} to fill before this entity can be published.`
      : '';
  return `Nexora Entity understands ${pct}% of this person's entity. ${lead}${tail}`.trim();
}

/** Requirement metadata for a stage, used when explaining why a stage matters. */
export function stageRequirement(stageKey: StageKey): StageRequirement {
  return STAGE_BY_KEY[stageKey]?.requirement ?? StageRequirement.recommended;
}
