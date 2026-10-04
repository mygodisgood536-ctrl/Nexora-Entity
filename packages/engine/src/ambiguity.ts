/**
 * Entity ambiguity detection (spec 14).
 *
 * Consistency is not enough. This engine asks a different question: could the information
 * collected reasonably describe more than one real person? When it could, the platform must
 * identify the distinguishing evidence that is missing and hold the final gate.
 */

import { IdentityState, round2 } from '@nexora/core';
import type { ClaimRecord } from '@nexora/db';

export interface AmbiguityCandidate {
  label: string;
  sourceId: string | null;
  sourceUrl: string | null;
  sourceTitle: string | null;
  identityState: IdentityState;
  identityScore: number;
  /** Signals shared with the subject. */
  sharedSignals: string[];
  /** Signals that would distinguish this candidate from the subject. */
  distinguishingSignals: string[];
  possibleCollision: boolean;
}

export interface DetectedAmbiguity {
  dimension: string;
  description: string;
  candidates: AmbiguityCandidate[];
  missingEvidence: string[];
  severity: 'blocking' | 'warning' | 'info';
}

export interface AmbiguityInput {
  subject: {
    names: string[];
    aliases: string[];
    professions: string[];
    organizations: string[];
    locations?: string[];
    biography?: string | null;
    handle?: string | null;
  };
  claims: ClaimRecord[];
  sources: {
    id: string;
    url: string;
    title: string | null;
    independence_group: string | null;
  }[];
  identityLinks: {
    source_id: string;
    resolved_state: IdentityState;
    score: number;
    signals: Record<string, unknown>;
    rationale: string | null;
    user_decision: 'accept' | 'reject' | null;
  }[];
}

function hasClaim(claims: ClaimRecord[], key: string, minLength = 1): boolean {
  return claims.some((c) => c.attribute_key === key && c.value_text.trim().length >= minLength);
}

/**
 * Dimension 1: a source carries the subject's name but none of the subject's other attributes,
 * which is the classic shape of two different people.
 */
export function detectNameCollision(input: AmbiguityInput): DetectedAmbiguity | null {
  const subjectNames = new Set(input.subject.names.map((n) => n.toLowerCase().trim()));

  const collisions = input.identityLinks.filter((link) => {
    if (link.user_decision) return false;
    const source = input.sources.find((s) => s.id === link.source_id);
    if (!source) return false;
    if (subjectNames.has((source.title ?? '').toLowerCase().trim())) return true;
    const signals = link.signals ?? {};
    const nameWeight = typeof signals['name_compatibility'] === 'number' ? signals['name_compatibility'] : 0;
    return nameWeight > 0 && link.score < 0.5;
  });

  if (collisions.length === 0) return null;

  const candidates: AmbiguityCandidate[] = collisions.map((link) => {
    const source = input.sources.find((s) => s.id === link.source_id);
    const signals = link.signals ?? {};
    const shared = Object.entries(signals)
      .filter(([, v]) => typeof v === 'number' && v > 0)
      .map(([k]) => k.replace(/_/g, ' '));
    return {
      label: source?.title ?? source?.url ?? 'Unknown source',
      sourceId: source?.id ?? null,
      sourceUrl: source?.url ?? null,
      sourceTitle: source?.title ?? null,
      identityState: link.resolved_state,
      identityScore: round2(link.score),
      sharedSignals: shared,
      distinguishingSignals: [],
      possibleCollision: true,
    };
  });

  return {
    dimension: 'name_collision',
    description:
      `${collisions.length} source(s) use a name that matches yours but do not carry enough of your ` +
      'other information. They may belong to a different person, and Nexora Entity will not attribute ' +
      'them to you without evidence.',
    candidates,
    missingEvidence: [
      'A source that links this profile to your own, for example a page where both names appear together.',
      'A distinguishing detail such as your organisation, your location, or a project only you have.',
      'Confirmation from you: does this profile belong to you?',
    ],
    severity: 'blocking',
  };
}

/**
 * Dimension 2: the entity is too thin to distinguish from anyone.
 */
export function detectThinEntity(input: AmbiguityInput): DetectedAmbiguity | null {
  const distinguishing = {
    alternateNames: input.subject.aliases.length >= 1,
    profession: input.subject.professions.length >= 1,
    organization: input.subject.organizations.length >= 1,
    location: (input.subject.locations ?? []).length >= 1 || hasClaim(input.claims, 'identity.location', 1),
    biography: Boolean(input.subject.biography && input.subject.biography.length > 60),
  };
  const count = Object.values(distinguishing).filter(Boolean).length;
  if (count >= 2) return null;

  const missing = Object.entries(distinguishing)
    .filter(([, present]) => !present)
    .map(([dimension]) => {
      switch (dimension) {
        case 'alternateNames':
          return 'At least one name people use for you, such as a nickname, a reordered name or a professional name, so your sources can be matched to you.';
        case 'profession':
          return 'What you currently do, so someone can tell you apart from others with your name.';
        case 'organization':
          return 'An organisation, company or community you belong to.';
        case 'location':
          return 'Where you are, or have been.';
        case 'biography':
          return 'A short biography, which is the single most effective way to tell one person from another.';
        default:
          return dimension;
      }
    });

  if (count === 1 && missing.length <= 1) return null;

  return {
    dimension: 'insufficient_distinction',
    description:
      'At the moment your entity carries too little distinguishing information. Someone reading your ' +
      'sources could not reliably tell you apart from other people with a similar name.',
    candidates: [],
    missingEvidence: missing,
    severity: count === 0 ? 'blocking' : 'warning',
  };
}

/** Dimension 3: unresolved disagreement makes two readings of the person plausible. */
export function detectSplitPerson(input: AmbiguityInput, openConflictAttributes: string[]): DetectedAmbiguity | null {
  if (openConflictAttributes.length === 0) return null;
  const candidates: AmbiguityCandidate[] = [];
  for (const attribute of openConflictAttributes) {
    for (const link of input.identityLinks) {
      if (link.resolved_state === IdentityState.confirmed) continue;
      const source = input.sources.find((s) => s.id === link.source_id);
      if (!source) continue;
      candidates.push({
        label: source.title ?? source.url,
        sourceId: source.id,
        sourceUrl: source.url,
        sourceTitle: source.title,
        identityState: link.resolved_state,
        identityScore: round2(link.score),
        sharedSignals: [attribute],
        distinguishingSignals: [],
        possibleCollision: true,
      });
    }
  }
  if (candidates.length === 0) return null;
  return {
    dimension: 'split_person',
    description:
      `Unresolved disagreement about ${openConflictAttributes.join(', ')} means your sources can currently ` +
      'be read as describing two different people.',
    candidates: candidates.slice(0, 10),
    missingEvidence: [
      'Your confirmation of the correct current value for each disagreement.',
      'One source that links the differing details together.',
    ],
    severity: 'blocking',
  };
}

export function runAmbiguityDetection(
  input: AmbiguityInput,
  openConflictAttributes: string[],
): DetectedAmbiguity[] {
  const out: DetectedAmbiguity[] = [];
  const thin = detectThinEntity(input);
  if (thin) out.push(thin);
  const collision = detectNameCollision(input);
  if (collision) out.push(collision);
  const split = detectSplitPerson(input, openConflictAttributes);
  if (split) out.push(split);
  return out;
}
