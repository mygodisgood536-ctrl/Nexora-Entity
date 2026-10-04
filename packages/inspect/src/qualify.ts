/**
 * Source qualification (spec §8, §11, §12).
 *
 * Counting entries is not enough. A source qualifies only when it is genuinely about the
 * subject, is live, and is not a duplicate of another source. These are Nexora Entity's own
 * internal requirements — never described as requirements imposed by Google.
 */

import { bigramDice, jaccard, normalizeText, registrableDomain, sha256Hex, textFingerprint } from '@nexora/core';
import type { InspectionResult } from './inspect';
import { looksLikePressWire } from './inspect';
import { SourceType } from '@nexora/core';

/** Subject facts used to judge whether a source is about this person. */
export interface SubjectProfile {
  /** Every legitimate name the person goes by. */
  names: string[];
  aliases: string[];
  /** Normalised terms for profession/org matching. */
  professions: string[];
  organizations: string[];
  projects: string[];
  locations: string[];
  handle?: string | null;
  /** Registrable domains the person declared as their own. */
  ownedDomains: string[];
  biography?: string | null;
}

export interface QualifierInput {
  url: string;
  inspection: InspectionResult;
  sourceType: SourceType;
  declaredKind: string;
  /** Whether the person declared this source as one of the websites that represent them. */
  declaredAsWebsite?: boolean;
  /** Whether the person declared this source as a press release or news article. */
  declaredAsPress?: boolean;
}

export interface SourceQualification {
  qualifiesWebsites: boolean;
  qualifiesPress: boolean;
  subjectRelevance: number;
  qualityScore: number;
  reasons: string[];
  blockers: string[];
  independenceGroup: string;
  assessment: string;
}

const NEWS_HOST_HINTS =
  /(news|times|post|herald|journal|gazette|tribune|daily|guardian|bbc|cnn|reuters|apnews|forbes|bloomberg|wired|techcrunch|theverge|medium|substack|blogspot|wordpress|newsfile|globenewswire|prnewswire|businesswire|einpresswire|independent|observer|echo|herald)/i;

/** Compute how strongly a source refers to the subject person. */
export function subjectRelevance(input: {
  inspection: InspectionResult;
  subject: SubjectProfile;
}): { score: number; matched: string[] } {
  const { subject } = input;
  const inspection = input.inspection;
  // A page that yielded no extraction (a login wall, an empty body, a connector that read
  // nothing) carries no evidence either way. Treating that as high relevance would let an
  // unreadable page be counted as evidence about the person.
  const extracted = inspection.extracted ?? ({} as InspectionResult['extracted']);
  const matched: string[] = [];

  const haystackParts: string[] = [
    inspection.title ?? '',
    inspection.description ?? '',
    inspection.textExcerpt ?? '',
    inspection.author ?? '',
    extracted.headline ?? '',
    extracted.organisation ?? '',
    ...(extracted.names ?? []),
    ...(extracted.headings ?? []),
    inspection.platformData ? JSON.stringify(inspection.platformData.facts).slice(0, 4000) : '',
  ];
  const haystack = normalizeText(haystackParts.join(' \n '));

  const scoreNames = (): number => {
    let best = 0;
    for (const name of [...subject.names, ...subject.aliases]) {
      const n = normalizeText(name);
      if (!n) continue;
      if (haystack.includes(n)) {
        best = Math.max(best, 1);
        matched.push(`name "${name}" appears on the page`);
        continue;
      }
      const parts = n.split(' ').filter((t) => t.length > 2);
      if (parts.length === 0) continue;
      const hits = parts.filter((p) => haystack.includes(p)).length;
      const ratio = hits / parts.length;
      // A full-name requirement is deliberately strict: two of three tokens is not a match
      // for a three-part name unless another signal corroborates.
      const threshold = parts.length >= 3 ? 1 : 0.9;
      if (ratio >= threshold) {
        best = Math.max(best, ratio);
        matched.push(`name "${name}" matches by ${hits}/${parts.length} tokens`);
      }
    }
    return best;
  };

  const scoreHandle = (): number => {
    if (!subject.handle) return 0;
    const h = normalizeText(subject.handle);
    if (h && haystack.includes(h)) {
      matched.push(`handle "${subject.handle}" appears on the page`);
      return 1;
    }
    return 0;
  };

  const scoreDomain = (): number => {
    const d = registrableDomain(input_url(inspection));
    if (!d) return 0;
    if (subject.ownedDomains.includes(d)) {
      matched.push(`site is on a domain the person declared as their own (${d})`);
      return 1;
    }
    return 0;
  };

  const scoreProfession = (): number => {
    const terms = normalizeText([...subject.professions, ...subject.organizations].join(' ')).split(' ').filter((t) => t.length > 3);
    if (terms.length === 0) return 0;
    const hits = terms.filter((t) => haystack.includes(t)).length;
    if (hits === 0) return 0;
    matched.push(`${hits} professional term(s) from the entity appear on the page`);
    return Math.min(1, hits / Math.max(2, terms.length * 0.4));
  };

  const sName = scoreNames();
  const sHandle = scoreHandle();
  const sDomain = scoreDomain();
  const sProf = scoreProfession();

  // A declared self-owned domain is decisive: the person controls it.
  if (sDomain >= 1) return { score: 1, matched: [...new Set(matched)] };

  // Weighted combination. Name is dominant; a single professional term alone is never enough.
  const score = Math.min(1, sName * 0.62 + sHandle * 0.2 + sProf * 0.18);
  return { score: Math.round(score * 100) / 100, matched: [...new Set(matched)] };
}

function input_url(i: InspectionResult): string {
  return i.finalUrl ?? i.url;
}

/** Map source type to an authority tier (spec §12). */
export function authorityTierFor(type: SourceType): number {
  switch (type) {
    case 'user_document':
    case 'user_photo':
      return 2;
    case 'self_authored_site':
      return 2;
    case 'self_declared_profile':
      return 3;
    case 'social_profile':
    case 'creator_profile':
      return 4;
    case 'professional_profile':
      return 4;
    case 'project_site':
    case 'organization_site':
      return 5;
    case 'press_wire':
      return 4;
    case 'independent_publication':
      return 5;
    case 'directory':
      return 2;
    case 'direct_authorized':
      return 6;
    default:
      return 2;
  }
}

/** Decide whether a source qualifies toward the internal 5-website / 4-press minimums. */
export function qualifySource(input: QualifierInput & { subject: SubjectProfile }): SourceQualification {
  const { subject, declaredKind } = input;
  const inspection = input.inspection;
  // See `subjectRelevance`: an extraction that yielded nothing is read defensively throughout,
  // so a page the platform could not read is never counted as evidence.
  const extracted = inspection.extracted ?? ({} as InspectionResult['extracted']);
  const url = input_url(inspection);
  const host = (() => {
    try {
      return new URL(url).hostname.replace(/^www\./, '');
    } catch {
      return null;
    }
  })();

  const reasons: string[] = [];
  const blockers: string[] = [];

  const reachable = inspection.accessStatus === 'accessible' || inspection.accessStatus === 'access_limited';
  if (inspection.accessStatus === 'not_found') blockers.push('The address does not exist (dead link).');
  if (inspection.accessStatus === 'network_error') blockers.push('The address could not be reached.');
  if (inspection.accessStatus === 'timeout') blockers.push('The address timed out.');
  if (inspection.accessStatus === 'blocked') blockers.push('The site blocked automated access, so its content could not be read.');
  if (inspection.accessStatus === 'private') blockers.push('The page requires a sign-in and could not be read.');
  if (inspection.accessStatus === 'invalid_url') blockers.push(inspection.accessDetail ?? 'The address is not usable.');
  if (extracted.challengePage) blockers.push('The site returned a bot-protection page instead of content.');
  if (!reachable) blockers.push('The address was never reachable, so it was not checked.');

  const relevance = subjectRelevance({ inspection, subject });
  const aboutSubject = relevance.score >= 0.55;
  if (!aboutSubject) {
    blockers.push(
      relevance.matched.length === 0
        ? "The page does not mention the person by any of their names or aliases."
        : `Only weak references to the person were found (${relevance.score.toFixed(2)} relevance).`,
    );
  } else {
    reasons.push(...relevance.matched);
  }

  const liveContent = inspection.textLength >= 250;
  if (!liveContent) blockers.push('The page has too little readable text to be a real representation of the person.');

  const isWire = looksLikePressWire(host);
  const declaredAsPress = input.declaredAsPress ?? (declaredKind === 'press_release' || declaredKind === 'news_article');
  const declaredAsWebsite = input.declaredAsWebsite ?? true;
  const hostLooksPressy = !!host && NEWS_HOST_HINTS.test(host);
  const articleSignals = extracted.isArticle || extracted.articlePublisher !== null;

  // A press release must be independently published material. The person's own declaration is
  // necessary but not sufficient: without an independence signal, their own site labelled a press
  // release would satisfy the press minimum on its own, which the standard exists to prevent.
  const independentAuthority =
    authorityTierFor(input.sourceType) >= authorityTierFor(SourceType.independentPublication) ||
    hostLooksPressy ||
    isWire;
  const isPress =
    declaredAsPress &&
    independentAuthority &&
    (articleSignals || hostLooksPressy || input.sourceType === SourceType.independentPublication);

  const qualityBase = authorityTierFor(input.sourceType);
  const qualityScore =
    Math.round(
      (Math.min(1, qualityBase / 6) * 0.5 + relevance.score * 0.3 + (liveContent ? 0.2 : 0) + (isWire ? -0.05 : 0.05)) * 100,
    ) / 100;

  const { group } = textFingerprintLike(inspection);

// Website minimum: a source the person declared as representing them, that is live, genuinely
  // about them, and not a duplicate. Press sources are counted separately by the engine.
  const qualifiesWebsites =
    declaredAsWebsite && blockers.length === 0 && aboutSubject && liveContent && inspection.inspected;

  const qualifiesPress =
    isPress && blockers.length === 0 && aboutSubject && liveContent && relevance.score >= 0.6 && inspection.inspected;

  if (qualifiesWebsites) reasons.push('Live, readable, and genuinely about the person.');
  if (qualifiesPress) reasons.push(`Independent published coverage about the person${isWire ? ' (press distribution service)' : ''}.`);
  if (!qualifiesPress && reachable && aboutSubject && declaredAsWebsite) {
    reasons.push('Counts toward the website minimum, not the press-release minimum: this is not an independent publication.');
  }
  if (extracted.loginWall) {
    reasons.push('Only public metadata was visible; the page asks visitors to sign in.');
  }
  if (inspection.platformNote) reasons.push(inspection.platformNote);

  return {
    qualifiesWebsites,
    qualifiesPress,
    subjectRelevance: relevance.score,
    qualityScore: Math.max(0, qualityScore),
    reasons,
    blockers,
    independenceGroup: group,
    assessment: assessmentSentence({ reachable, aboutSubject, liveContent, isPress, qualifiesWebsites, qualifiesPress }),
  };
}

function assessmentSentence(s: {
  reachable: boolean;
  aboutSubject: boolean;
  liveContent: boolean;
  isPress: boolean;
  qualifiesWebsites: boolean;
  qualifiesPress: boolean;
}): string {
  if (!s.reachable) return 'This address could not be read, so Nexora Entity cannot treat it as evidence.';
  if (!s.aboutSubject) return 'This page was read but does not clearly represent the same person.';
  if (!s.liveContent) return 'This page contains too little content to represent the person.';
  if (s.qualifiesPress) return 'Read successfully. It is independent published coverage about the person.';
  if (s.qualifiesWebsites) return 'Read successfully. It is a live public page genuinely representing the person.';
  return 'Read successfully, but it does not meet the quality bar Nexora Entity applies to qualifying sources.';
}

function textFingerprintLike(inspection: InspectionResult): { group: string; tokenCount: number } {
  const tokens = textFingerprint(`${inspection.title ?? ''} ${inspection.textExcerpt ?? ''}`);
  const unique = [...new Set(tokens)];
  const group = sha256Hex(unique.sort().join(' ')).slice(0, 24);
  return { group, tokenCount: unique.length };
}

export interface DuplicateAssessment {
  duplicateOfId: string | null;
  similarity: number;
  sameDomain: boolean;
  reason: string;
}

/**
 * Detect duplicate or syndicated sources. Four websites that copy one press release are one
 * source, not four (spec §11).
 */
export function assessDuplicate(
  candidate: { id: string; url: string; inspection: InspectionResult; independenceGroup: string },
  others: { id: string; url: string; textExcerpt: string | null; independenceGroup: string; title: string | null }[],
): DuplicateAssessment {
  const candText = `${candidate.inspection.title ?? ''} ${candidate.inspection.textExcerpt ?? ''}`;
  const candDomain = registrableDomain(candidate.url);
  let best: DuplicateAssessment = {
    duplicateOfId: null,
    similarity: 0,
    sameDomain: false,
    reason: 'No other source carries substantially the same content.',
  };
  for (const other of others) {
    if (other.id === candidate.id) continue;
    const sameDomain = !!candDomain && candDomain === registrableDomain(other.url);
    const groupMatch = candidate.independenceGroup === other.independenceGroup;
    const otherText = `${other.title ?? ''} ${other.textExcerpt ?? ''}`;
    const textSimilarity = bigramDice(candText, otherText);
    const tokenOverlap = jaccard(
      textFingerprint(candText),
      textFingerprint(otherText),
    );
    const similarity = Math.max(textSimilarity, tokenOverlap);
    if (groupMatch && otherText.length > 200) {
      return {
        duplicateOfId: other.id,
        similarity: 1,
        sameDomain,
        reason: 'Identical title and body content — this is the same source, republished or duplicated.',
      };
    }
    if (similarity >= 0.82) {
      return {
        duplicateOfId: other.id,
        similarity: Math.round(similarity * 100) / 100,
        sameDomain,
        reason: `Content is ${Math.round(similarity * 100)}% identical to an existing source, so it is a copy rather than an independent source.`,
      };
    }
    if (similarity > best.similarity) {
      best = {
        duplicateOfId: null,
        similarity: Math.round(similarity * 100) / 100,
        sameDomain,
        reason: `Most similar source so far is ${Math.round(similarity * 100)}% identical — below the duplication threshold.`,
      };
    }
  }
  return best;
}