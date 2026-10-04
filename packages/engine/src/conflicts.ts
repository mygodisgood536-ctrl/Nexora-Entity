/**
 * Conflict detection (spec 13).
 *
 * Detects meaningful contradictions, not differences in wording. Historical differences are
 * not automatically conflicts: a person being a student in one period and a developer later is
 * a coherent history. Dates drive the resolution.
 */

import {
  ConflictKind,
  Severity,
  SourceType,
  bigramDice,
  jaccard,
  normalizeText,
  round2,
} from '@nexora/core';
import type { ClaimRecord } from '@nexora/db';

export interface DetectedConflict {
  attributeKey: string;
  kind: ConflictKind;
  severity: Severity;
  claimIds: string[];
  sourceIds: string[];
  description: string;
  userMessage: string;
  evidence: Record<string, unknown>;
}

/** Attributes where different values can genuinely coexist (multiple roles, skills, projects). */
const MULTI_VALUE_ATTRIBUTES = new Set([
  'identity.alias',
  'professional.profession',
  'professional.title',
  'professional.specialisation',
  'professional.service',
  'professional.industry',
  'skills.skill',
  'skills.language',
  'skills.subjectArea',
  'organizations.affiliation',
  'organizations.membership',
  'projects.project',
  'products.product',
  'products.service',
  'achievements.achievement',
  'publications.item',
  'websites.website',
  'profiles.profile',
  'presence.page',
  'about.interests',
  'other.fact',
  'dates.event',
  'contact.contact',
  'contact.email',
  'contact.phone',
  'contact.whatsapp',
  'contact.booking',
  'contact.page',
  'contact.address',
  'location.entry',
  'career.role',
  'education.qualification',
]);

/** Attributes where two different current values are a genuine contradiction. */
const SINGLE_VALUE_ATTRIBUTES = new Set([
  'identity.primaryName',
  'identity.fullPublicName',
  'professional.currentCompany',
  'identity.location',
  'identity.birthDate',
  'identity.headline',
]);

/** Attributes about biography/description that are naturally overlapping. */
const PROSE_ATTRIBUTES = new Set([
  'about.biography',
  'about.shortBio',
  'about.knownFor',
  'about.expertiseSummary',
  'professional.currentFocus',
]);

/**
 * Observations read out of inspected sources (`discovered.*`).
 *
 * These are *observations from many sources*, not competing values for one slot. Two
 * different profile URLs is a person with two profiles, not a contradiction. Two different
 * descriptions is two pages describing the same person in different words, which §13
 * explicitly says is not a conflict.
 *
 * Without this, every pair of discovered claims fell through to `valueContradiction` and the
 * engine produced thousands of fabricated conflicts — enough round trips to exhaust the
 * database pool and terminate the pipeline mid-run.
 */
const DISCOVERED_PREFIX = 'discovered.';

function isDiscovered(attributeKey: string): boolean {
  return attributeKey.startsWith(DISCOVERED_PREFIX);
}

export interface TemporalInfo {
  start: string | null;
  end: string | null;
  current: boolean | null;
}

function yearOf(value: string | null | undefined): number | null {
  if (!value) return null;
  const m = /(19|20)\d{2}/.exec(value);
  return m ? Number.parseInt(m[0], 10) : null;
}

/** Do two periods overlap? An open-ended period counts as ongoing. */
export function periodsOverlap(a: TemporalInfo, b: TemporalInfo): boolean {
  const aStart = yearOf(a.start);
  const aEnd = yearOf(a.end);
  const bStart = yearOf(b.start);
  const bEnd = yearOf(b.end);
  if (a.current === false && bStart !== null && aEnd !== null && bStart > aEnd) return false;
  if (b.current === false && aStart !== null && bEnd !== null && aEnd === null) return false;
  if (b.current === false && aStart !== null && bEnd !== null && bEnd < aStart) return false;
  if (aStart !== null && bEnd !== null && bEnd < aStart) return false;
  if (bStart !== null && aEnd !== null && aEnd < bStart) return false;
  return true;
}

/** Are these two statements about different periods rather than the same moment? */
function temporalSeparation(a: TemporalInfo, b: TemporalInfo): boolean {
  if (a.current === true && b.current === false) return true;
  if (a.current === false && b.current === true) return true;
  const aStart = yearOf(a.start);
  const bStart = yearOf(b.start);
  if (aStart !== null && bStart !== null && Math.abs(aStart - bStart) >= 1) return true;
  return false;
}

function valuesConflict(
  a: string,
  b: string,
): { conflict: boolean; similarity: number; reason: string } {
  const na = normalizeText(a);
  const nb = normalizeText(b);
  if (na === nb) return { conflict: false, similarity: 1, reason: 'identical values' };
  const similarity = Math.max(bigramDice(na, nb), jaccard(na.split(' '), nb.split(' ')));
  if (similarity >= 0.72) {
    return {
      conflict: false,
      similarity,
      reason: 'the two statements say the same thing in different words',
    };
  }
  return {
    conflict: true,
    similarity: round2(similarity),
    reason: `the two sources state materially different values (${Math.round(similarity * 100)}% similar)`,
  };
}

export interface ConflictDetectionInput {
  claims: ClaimRecord[];
  sourceMeta: Record<
    string,
    { url: string; title: string | null; sourceType: SourceType | null; independenceGroup: string | null }
  >;
}

export function detectConflicts(input: ConflictDetectionInput): DetectedConflict[] {
  const byAttribute = new Map<string, ClaimRecord[]>();
  for (const c of input.claims) {
    if (c.status === 'rejected') continue;
    const list = byAttribute.get(c.attribute_key) ?? [];
    list.push(c);
    byAttribute.set(c.attribute_key, list);
  }

  const conflicts: DetectedConflict[] = [];

  for (const [attributeKey, claims] of byAttribute) {
    if (claims.length < 2) continue;

    // A `discovered.*` claim is an observation read out of one source, not a value competing
    // for a single slot. Several different values coexist by design: a person has many
    // profiles, many aliases and many published emails. Two pages describing the same person
    // in different words is not a contradiction either (§13).
    //
    // Whether two observations point at two different people is the question §14 ambiguity
    // detection answers, not this one. Treating them as conflicts here fabricated thousands
    // of them and was fatal to the pipeline.
    if (isDiscovered(attributeKey)) continue;

    for (let i = 0; i < claims.length; i += 1) {
      for (let j = i + 1; j < claims.length; j += 1) {
        const a = claims[i];
        const b = claims[j];
        if (!a || !b) continue;

        const cmp = valuesConflict(a.value_text, b.value_text);
        if (!cmp.conflict) continue;

        const ta: TemporalInfo = { start: a.period_start, end: a.period_end, current: a.is_current };
        const tb: TemporalInfo = { start: b.period_start, end: b.period_end, current: b.is_current };

        const sameSourceGroup =
          a.independence_group !== null && a.independence_group === b.independence_group;

        // Wording differences in prose are never conflicts.
        if (PROSE_ATTRIBUTES.has(attributeKey)) continue;

        if (MULTI_VALUE_ATTRIBUTES.has(attributeKey)) {
          // Multiple roles, projects and skills are legitimate. Only flag when two claims both
          // assert the current value of an attribute that can only hold one.
          const bothCurrent = a.is_current === true && b.is_current === true;
          const exclusive = SINGLE_VALUE_ATTRIBUTES.has(attributeKey);
          if (!bothCurrent || !exclusive) continue;
          if (temporalSeparation(ta, tb)) continue;
        }

        if (temporalSeparation(ta, tb)) {
          // A dated change of role is a coherent history, not a contradiction.
          conflicts.push({
            attributeKey,
            kind: ConflictKind.temporalOverride,
            severity: 'warning',
            claimIds: [a.id, b.id],
            sourceIds: [a.source_id, b.source_id].filter((v): v is string => !!v),
            description:
              `"${a.value_text}" (${a.period_start ?? 'undated'} to ${a.period_end ?? 'present'}) and ` +
              `"${b.value_text}" (${b.period_start ?? 'undated'} to ${b.period_end ?? 'present'}) describe ` +
              'different periods and were treated as a change over time rather than a contradiction.',
            userMessage:
              'Two of your sources describe different periods of your career. Nexora Entity treated this as a change over time. Please confirm the order is right.',
            evidence: { similarity: cmp.similarity, temporalSeparation: true, independenceShared: sameSourceGroup },
          });
          continue;
        }

        if (sameSourceGroup) {
          // Two claims from sources in the same independence group are not independent evidence.
          conflicts.push({
            attributeKey,
            kind: ConflictKind.unsupportedAssociation,
            severity: 'warning',
            claimIds: [a.id, b.id],
            sourceIds: [a.source_id, b.source_id].filter((v): v is string => !!v),
            description:
              `Sources that share the same underlying content disagree about ${attributeKey}: ` +
              `"${a.value_text}" vs "${b.value_text}". Because these sources are not independent of ` +
              'each other, this cannot be settled by counting them.',
            userMessage:
              'Two pages that appear to share the same original content describe your information differently. Which is correct?',
            evidence: { similarity: cmp.similarity, independenceShared: true },
          });
          continue;
        }

        const authorityGap = Math.abs(a.authority_tier - b.authority_tier);
        const severity: Severity =
          SINGLE_VALUE_ATTRIBUTES.has(attributeKey) || authorityGap >= 2 ? 'blocking' : 'warning';

        conflicts.push({
          attributeKey,
          kind: ConflictKind.valueContradiction,
          severity,
          claimIds: [a.id, b.id],
          sourceIds: [a.source_id, b.source_id].filter((v): v is string => !!v),
          description:
            `Conflicting current values for ${attributeKey}: "${a.value_text}" (${describeSource(input, a)}) ` +
            `vs "${b.value_text}" (${describeSource(input, b)}). ${cmp.reason}.`,
          userMessage: buildUserMessage(attributeKey, a, b, input),
          evidence: { similarity: cmp.similarity, authorityGap },
        });
      }
    }
  }

  return conflicts;
}

function describeSource(input: ConflictDetectionInput, claim: ClaimRecord): string {
  if (!claim.source_id) return claim.origin === 'user' ? 'your own entry' : 'no source';
  const meta = input.sourceMeta[claim.source_id];
  if (!meta) return 'an unknown source';
  try {
    return new URL(meta.url).hostname;
  } catch {
    return meta.url;
  }
}

function buildUserMessage(
  attributeKey: string,
  a: ClaimRecord,
  b: ClaimRecord,
  input: ConflictDetectionInput,
): string {
  const hostA = a.source_id ? hostOf(input, a.source_id) : 'your own entry';
  const hostB = b.source_id ? hostOf(input, b.source_id) : 'another source';
  const label = humanLabel(attributeKey);
  return (
    `Your current ${label} is not the same on every source. ${hostA} says "${a.value_text}". ` +
    `${hostB} says "${b.value_text}". Please confirm which is correct. Your answer becomes the ` +
    'authoritative value in Nexora Entity, and the other is kept with its provenance.'
  );
}

function hostOf(input: ConflictDetectionInput, sourceId: string): string {
  const meta = input.sourceMeta[sourceId];
  if (!meta) return 'a source';
  try {
    return new URL(meta.url).hostname;
  } catch {
    return meta.url;
  }
}

const ATTRIBUTE_LABELS: Record<string, string> = {
  'identity.primaryName': 'primary name',
  'identity.fullPublicName': 'full public name',
  'identity.alias': 'alternate name',
  'identity.location': 'location',
  'identity.birthDate': 'date of birth',
  'identity.headline': 'headline',
  'about.biography': 'biography',
  'professional.profession': 'profession',
  'professional.currentCompany': 'current company',
  'professional.title': 'title',
  'career.role': 'work history',
  'education.qualification': 'education',
  'organizations.affiliation': 'organisations',
  'projects.project': 'projects',
};

export function humanLabel(attributeKey: string): string {
  const direct = ATTRIBUTE_LABELS[attributeKey];
  if (direct) return direct;
  const tail = attributeKey.split('.').pop() ?? attributeKey;
  return tail.replace(/([A-Z])/g, ' $1').toLowerCase();
}

/** Structural checks that do not depend on comparing two values. */
export function detectLogicalContradictions(claims: ClaimRecord[]): DetectedConflict[] {
  const out: DetectedConflict[] = [];

  for (const c of claims.filter((x) => x.period_start !== null && x.period_end !== null)) {
    const sy = yearOf(c.period_start);
    const ey = yearOf(c.period_end);
    if (sy !== null && ey !== null && ey < sy) {
      out.push({
        attributeKey: c.attribute_key,
        kind: ConflictKind.logicalContradiction,
        severity: 'blocking',
        claimIds: [c.id],
        sourceIds: c.source_id ? [c.source_id] : [],
        description: `"${c.value_text}" is recorded as starting in ${sy} and ending in ${ey}, which is impossible.`,
        userMessage: `The dates for "${c.value_text}" end before they begin. Please correct the period.`,
        evidence: { startYear: sy, endYear: ey },
      });
    }
  }

  const nowYear = new Date().getFullYear();
  for (const c of claims.filter((x) => x.attribute_key === 'identity.birthDate')) {
    const y = yearOf(c.value_text);
    if (y !== null && y > nowYear) {
      out.push({
        attributeKey: c.attribute_key,
        kind: ConflictKind.logicalContradiction,
        severity: 'blocking',
        claimIds: [c.id],
        sourceIds: [],
        description: `The recorded date of birth is in the future (${y}).`,
        userMessage: 'The date of birth you provided is in the future. Please correct it.',
        evidence: { year: y, currentYear: nowYear },
      });
    }
  }

  return out;
}

export interface LogicalCheckResult {
  ok: boolean;
  conflicts: DetectedConflict[];
}
