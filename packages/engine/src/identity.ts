/**
 * Identity resolution engine (spec §10).
 *
 * Exact name matching is explicitly NOT the rule, and similar names alone are never enough.
 * A relationship becomes authoritative only when several independent signals agree.
 *
 * Signals used (all must be genuine observations of the source, never assumptions):
 *   name compatibility · declared aliases · handle match · owned domain · platform
 *   profession/organisation overlap · biography overlap · location overlap · cross-links
 *
 * Resulting states: confirmed · probable/needs-review · uncertain · conflict · rejected
 */

import {
  IdentityState,
  SourceType,
  bigramDice,
  clampConfidence,
  nameTokens,
  normalizeText,
  registrableDomain,
  round2,
  shortFormCandidates,
  jaccard,
} from '@nexora/core';
import type { InspectionResult } from '@nexora/inspect';

export interface IdentitySignal {
  name: string;
  weight: number;
  /** Human-readable observation. */
  observation: string;
  /** True when the signal points toward the subject; false when it argues against. */
  supports: boolean;
  /** Whether this signal comes from a source independent of the others. */
  independent: boolean;
}

export interface IdentityInput {
  subject: {
    names: string[];
    aliases: string[];
    professions: string[];
    organizations: string[];
    projects: string[];
    biography?: string | null;
    locations?: string[];
    handle?: string | null;
    ownedDomains: string[];
  };
  inspection: InspectionResult;
  sourceUrl: string;
  sourceType: SourceType;
  /** Identity links already accepted/rejected by the user. */
  userDecision?: 'accept' | 'reject' | null;
}

export interface IdentityResolution {
  state: IdentityState;
  score: number;
  signals: IdentitySignal[];
  rationale: string;
  method: 'deterministic' | 'deterministic+ai';
  /** What evidence is still missing to move to the next state. */
  missingEvidence: string[];
}

const THRESHOLDS = {
  confirmed: 0.72,
  probable: 0.5,
  uncertain: 0.34,
} as const;

/** Compatibility between an observed name and one of the subject's names/aliases. */
export function nameCompatibility(observed: string, candidate: string): { score: number; reason: string } {
  const o = nameTokens(observed);
  const c = nameTokens(candidate);
  if (o.substantive.length === 0 || c.substantive.length === 0) return { score: 0, reason: 'no comparable name tokens' };

  if (o.normalized === c.normalized) return { score: 1, reason: `identical name "${observed}"` };

  const oSet = new Set(o.substantive);
  const cSet = new Set(c.substantive);
  const inter = [...oSet].filter((t) => cSet.has(t)).length;

  // A subset match (first+last present, middle dropped, or reordered) is legitimate.
  const oInC = o.substantive.every((t) => cSet.has(t));
  const cInO = c.substantive.every((t) => oSet.has(t));

  // Nickname / short form compatibility.
  let shortFormHit = false;
  for (const t of o.substantive) {
    const candidates = shortFormCandidates(t);
    if (candidates.some((x) => cSet.has(x) || c.substantive.some((ct) => shortFormCandidates(ct).includes(t)))) {
      shortFormHit = true;
      break;
    }
  }

  if (oInC && oSet.size >= 2) return { score: 0.94, reason: `"${observed}" is a subset of "${candidate}" (missing or extra middle name)` };
  if (cInO && oSet.size >= 2) return { score: 0.9, reason: `"${candidate}" is a subset of "${observed}" (extra middle name on the source)` };
  if (shortFormHit && inter >= 1) return { score: 0.82, reason: `"${observed}" is a nickname or short form of "${candidate}"` };

  // Token overlap ratio.
  const ratio = inter / Math.max(oSet.size, cSet.size);
  if (ratio >= 0.75 && oSet.size >= 2) {
    return { score: 0.78, reason: `${inter} of ${oSet.size} name tokens match "${candidate}"` };
  }
  const fuzzy = bigramDice(o.normalized, c.normalized);
  if (fuzzy >= 0.8 && inter >= 1) {
    return { score: 0.7, reason: `"${observed}" closely resembles "${candidate}"` };
  }
  if (inter >= 1 && oSet.size >= 2 && cSet.size >= 2) {
    return { score: 0.35 + ratio * 0.3, reason: `only ${inter} shared name token(s) with "${candidate}"` };
  }
  return { score: 0, reason: `no name compatibility with "${candidate}"` };
}

/** Best compatibility between an observed name and all of the subject's names. */
function bestNameSignal(observed: string, subject: IdentityInput['subject']): IdentitySignal | null {
  const candidates = [...subject.names, ...subject.aliases];
  let best = { score: 0, reason: '', candidate: '' };
  for (const c of candidates) {
    const r = nameCompatibility(observed, c);
    if (r.score > best.score) best = { score: r.score, reason: r.reason, candidate: c };
  }
  if (best.score <= 0) return null;
  return {
    name: 'name_compatibility',
    weight: 0.34,
    supports: best.score >= 0.5,
    independent: true,
    observation: `Source name "${observed}" vs subject name: ${best.reason}.`,
  };
}

function overlapSignal(
  observed: string,
  subjectTerms: string[],
  name: string,
  weight: number,
  independent: boolean,
  minHits = 1,
): IdentitySignal | null {
  const terms = normalizeText(subjectTerms.join(' ')).split(' ').filter((t) => t.length > 3);
  if (terms.length === 0) return null;
  const hay = normalizeText(observed);
  const hits = terms.filter((t) => hay.includes(t));
  if (hits.length < minHits) return null;
  return {
    name,
    weight,
    supports: true,
    independent,
    observation: `${hits.length} shared term(s) with the subject: ${hits.slice(0, 5).join(', ')}.`,
  };
}

function similaritySignal(a: string, b: string, name: string, weight: number): IdentitySignal | null {
  if (!a || !b) return null;
  const sim = jaccard(normalizeText(a).split(' '), normalizeText(b).split(' '));
  if (sim < 0.25) return null;
  return {
    name,
    weight,
    supports: true,
    independent: true,
    observation: `Text similarity ${(sim * 100).toFixed(0)}% between the source biography and the subject's.`,
  };
}

/**
 * Deterministic identity resolution over real observations.
 */
export function resolveIdentity(input: IdentityInput): IdentityResolution {
  const { subject, inspection } = input;
  const signals: IdentitySignal[] = [];

  // Every extracted list is optional in the record type, and a page with no detected name
  // yields none at all, so each is read defensively rather than spread directly.
  const extracted = inspection.extracted ?? {};
  const observedNames = [
    ...(extracted.names ?? []),
    ...(extracted.alternateNames ?? []),
    inspection.title ?? '',
    ...(inspection.platformData?.facts?.['name'] ? [String(inspection.platformData.facts['name'])] : []),
    ...(inspection.platformData?.facts?.['displayName'] ? [String(inspection.platformData.facts['displayName'])] : []),
    ...(inspection.platformData?.facts?.['givenNames'] && inspection.platformData?.facts?.['familyNames']
      ? [`${String(inspection.platformData.facts['givenNames'])} ${String(inspection.platformData.facts['familyNames'])}`]
      : []),
    inspection.author ?? '',
  ].filter((n) => typeof n === 'string' && n.trim().length > 1 && n.length < 120);

  const seenNameReasons = new Set<string>();
  for (const observed of observedNames.slice(0, 12)) {
    const s = bestNameSignal(observed, subject);
    if (!s) continue;
    const dedupe = s.observation.replace(/"[^"]*"/g, '');
    if (seenNameReasons.has(dedupe)) continue;
    seenNameReasons.add(dedupe);
    signals.push(s);
  }

  // Handle signal.
  if (subject.handle) {
    const h = normalizeText(subject.handle);
    const hay = normalizeText(
      [
        inspection.platformHandle ?? '',
        inspection.url,
        ...inspection.extracted.profileLinks,
        ...inspection.extracted.sameAs,
        ...observedNames,
      ].join(' '),
    );
    if (h && hay.includes(h)) {
      signals.push({
        name: 'handle_match',
        weight: 0.2,
        supports: true,
        independent: true,
        observation: `The subject's handle "@${subject.handle}" appears on this source.`,
      });
    }
  }

  // Owned domain signal — decisive on its own.
  const domain = registrableDomain(inspection.finalUrl ?? input.sourceUrl);
  if (domain && subject.ownedDomains.includes(domain)) {
    signals.push({
      name: 'owned_domain',
      weight: 0.45,
      supports: true,
      independent: true,
      observation: `This source is on ${domain}, a domain the person declared as their own.`,
    });
  }

  const textPool = [
    inspection.title ?? '',
    inspection.description ?? '',
    inspection.textExcerpt ?? '',
    inspection.extracted.headline ?? '',
    inspection.platformData ? JSON.stringify(inspection.platformData.facts).slice(0, 3000) : '',
  ].join(' \n ');

  const prof = overlapSignal(textPool, subject.professions, 'profession_overlap', 0.11, true);
  if (prof) signals.push(prof);
  const org = overlapSignal(textPool, subject.organizations, 'organisation_overlap', 0.09, false);
  if (org) signals.push(org);
  const proj = overlapSignal(textPool, subject.projects, 'project_overlap', 0.09, false, 1);
  if (proj) signals.push(proj);

  if (subject.biography) {
    const bio = similaritySignal(subject.biography, `${inspection.description ?? ''} ${inspection.textExcerpt ?? ''}`, 'biography_overlap', 0.12);
    if (bio) signals.push(bio);
  }

  if ((subject.locations ?? []).length > 0) {
    const loc = overlapSignal(textPool, subject.locations ?? [], 'location_overlap', 0.05, false);
    if (loc) signals.push(loc);
  }

  // Cross-links: the source links to another source that is on an owned domain.
  // A page with no extracted links carries no cross-link evidence either way.
  const crossLinked = (extracted.profileLinks ?? []).some((l) => {
    const d = registrableDomain(l);
    return d !== null && subject.ownedDomains.includes(d);
  });
  if (crossLinked) {
    signals.push({
      name: 'cross_link',
      weight: 0.08,
      supports: true,
      independent: false,
      observation: 'This source links to another profile on a domain the person declared as their own.',
    });
  }

  // Evidence that argues against the relationship.
  const blockers: IdentitySignal[] = [];
  if (inspection.accessStatus !== 'accessible') {
    blockers.push({
      name: 'not_readable',
      weight: 0,
      supports: false,
      independent: true,
      observation: `The source could not be read (${inspection.accessStatus}), so identity cannot be established from it.`,
    });
  }
  if (inspection.extracted.challengePage) {
    blockers.push({
      name: 'challenge_page',
      weight: 0,
      supports: false,
      independent: true,
      observation: 'The site returned a bot-protection page, so no profile content was available.',
    });
  }

  const positive = signals.filter((s) => s.supports);
  // Diminishing returns: independent signals count more, and total is bounded at 1.
  const rawScore = positive.reduce((acc, s, i) => acc + s.weight * (s.independent ? 1 : 0.5) * (i === 0 ? 1 : 0.92), 0);
  let score = clampConfidence(Math.min(1, rawScore));

  // A name signal that actively argues against (present but incompatible) matters.
  const incompatible = signals.filter((s) => s.name === 'name_compatibility' && !s.supports);
  if (incompatible.length > 0) score *= 0.55;

  const independentSupportCount = positive.filter((s) => s.independent).length;
  const missingEvidence: string[] = [];

  let state: IdentityState;
  if (blockers.some((b) => b.name === 'not_readable' || b.name === 'challenge_page')) {
    // A source that could not be read contributes no evidence at all. Calling that "uncertain"
    // would put it in the review queue and ask the person to judge a page they never saw, so it
    // is rejected outright and reported as unreadable rather than as a judgement call.
    state = IdentityState.rejected;
    missingEvidence.push('A readable copy of this profile is needed before identity can be assessed.');
  } else if (score >= THRESHOLDS.confirmed && independentSupportCount >= 2) {
    state = IdentityState.confirmed;
  } else if (score >= THRESHOLDS.probable && independentSupportCount >= 1) {
    state = IdentityState.probableNeedsReview;
    missingEvidence.push(
      `One more independent signal is needed (currently ${independentSupportCount}). For example, a source that both names the person and links to a profile they declared.`,
    );
  } else if (score >= THRESHOLDS.uncertain) {
    state = IdentityState.uncertain;
    missingEvidence.push('More than one genuine signal is needed before this source can be attributed to the person.');
  } else {
    state = IdentityState.conflict;
    missingEvidence.push(
      'The signals found do not support attributing this source to the person. Similar names alone are never sufficient.',
    );
  }

  if (input.userDecision === 'accept' && state !== IdentityState.confirmed) {
    state = IdentityState.confirmed;
    score = Math.max(score, THRESHOLDS.confirmed);
  }
  if (input.userDecision === 'reject') {
    state = IdentityState.rejected;
    score = 0;
  }

  const rationale = buildRationale(state, signals, blockers, score);

  return {
    state,
    score: round2(score),
    signals: [...signals, ...blockers],
    rationale,
    method: 'deterministic',
    missingEvidence,
  };
}

function buildRationale(
  state: IdentityState,
  signals: IdentitySignal[],
  blockers: IdentitySignal[],
  score: number,
): string {
  const supporting = signals.filter((s) => s.supports);
  const against = [...signals.filter((s) => !s.supports), ...blockers];
  const head =
    state === IdentityState.confirmed
      ? 'Nexora Entity is confident this source represents the same real-world person.'
      : state === IdentityState.probableNeedsReview
        ? 'The evidence leans towards this source representing the person, but it is not yet conclusive.'
        : state === IdentityState.uncertain
          ? 'There is not enough evidence to say whether this source represents the person.'
          : state === IdentityState.rejected
            ? 'The person rejected this source as their own.'
            : 'The evidence found does not support attributing this source to the person.';
  const parts: string[] = [`Confidence ${Math.round(score * 100)}%.`];
  if (supporting.length) parts.push(`Supporting: ${supporting.slice(0, 4).map((s) => s.observation).join(' ')}`);
  if (against.length) parts.push(`Against: ${against.slice(0, 3).map((s) => s.observation).join(' ')}`);
  if (supporting.length <= 1 && state !== IdentityState.rejected) {
    parts.push('A single signal is never enough on its own.');
  }
  return `${head} ${parts.join(' ')}`;
}