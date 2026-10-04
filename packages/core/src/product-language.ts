/**
 * Product-language guard.
 *
 * Spec §31 forbids promising or implying Google verification, Google approval, Google
 * endorsement, or a guaranteed Knowledge Panel. This module is the single enforcement point:
 *
 *  - `assertNoSearchEngineGuarantee()` is called on every user-visible readiness string.
 *  - `scanForProhibitedClaims()` is used by tests and by the readiness publisher to verify
 *    that no prohibited phrasing has leaked into user-facing copy.
 *
 * Forbidden concepts: Google verification / Google verified / Google approval / Google approved /
 * Google endorsement / Google endorsed / Knowledge Panel guarantee / guaranteed knowledge panel /
 * guaranteed panel / 100% guaranteed panel / rank in Google / first page of Google.
 */

const PROHIBITED_PATTERNS: { pattern: RegExp; why: string }[] = [
  { pattern: /google[\s-]?(verified|verification)/i, why: 'implies verification by Google' },
  { pattern: /(verified|verification|certified|accredited|approved|authorised|authorized)\s+by\s+google/i, why: 'claims a Google certification or approval' },
  { pattern: /google[\s-]?(approved|approval)/i, why: 'implies approval by Google' },
  { pattern: /google[\s-]?(endorse|endorsed|endorsement)/i, why: 'implies endorsement by Google' },
  { pattern: /google[\s-]?(partner|partnership|programme|program)/i, why: 'implies an official Google relationship' },
  { pattern: /official\s+google/i, why: 'implies an official Google relationship' },
  { pattern: /guaranteed?\s+(a\s+)?knowledge panel/i, why: 'guarantees a Knowledge Panel' },
  { pattern: /knowledge panel guaranteed/i, why: 'guarantees a Knowledge Panel' },
  { pattern: /100%\s*guaranteed?\s+panel/i, why: 'guarantees a Knowledge Panel' },
  { pattern: /google\s+knowledge\s+panel\s+guarantee/i, why: 'guarantees a Knowledge Panel' },
  // "will get you a panel" style promises, with any filler allowed between the verb and the noun.
  { pattern: /(will|shall|guarantee[ds]?)\b[^.]{0,30}?\b(get|receive|have|earn|win|secure|obtain)\b[^.]{0,20}?\bknowledge panel/i, why: 'guarantees a Knowledge Panel' },
  { pattern: /guaranteed?\s+(panel|knowledge graph)/i, why: 'guarantees a Knowledge Panel' },
  { pattern: /rank\s+(#?\s*)?(first|number one|1)\s+(on|in)\s+google/i, why: 'promises a Google ranking' },
  { pattern: /knows?\s+google'?s?\s+(knowledge graph|private)/i, why: 'claims knowledge of Google internal state' },
  { pattern: /access(?:es)?\s+google'?s?\s+(knowledge graph|private data)/i, why: 'claims knowledge of Google internal state' },
];

/**
 * Explicit disclaimers that must survive the guard.
 *
 * The product is required to state plainly that "verified" means verified to Nexora Entity's own
 * standard and is not a Google approval. Without this carve-out the guard would reject the very
 * sentences that keep the distinction honest, so a match inside one of these is not a violation.
 */
const NEGATION_WINDOW = 48;
const DISCLAIMER_MARKERS = [
  'not a',
  'not an',
  'never means',
  'never a',
  'is not',
  'are not',
  'no claim',
  'does not',
  'doesn\u2019t',
  'does not mean',
  'independently decides',
  'has no access',
  'separate from',
  'distinct from',
  'as distinct from',
];

function isDisclaimed(text: string, matchIndex: number): boolean {
  // Only the sentence containing the match is considered, so a disclaimer elsewhere cannot
  // excuse a claim made here.
  const start = text.lastIndexOf('.', matchIndex) + 1;
  const endDot = text.indexOf('.', matchIndex);
  const end = endDot === -1 ? text.length : endDot + 1;
  const sentence = text.slice(start, end);
  const offsetInSentence = matchIndex - start;
  const window = sentence.slice(Math.max(0, offsetInSentence - NEGATION_WINDOW), offsetInSentence).toLowerCase();
  return DISCLAIMER_MARKERS.some((marker) => window.includes(marker));
}

export interface ProhibitedClaimHit {
  text: string;
  match: string;
  why: string;
}

/** The reasons a claim can be rejected, in the order they are checked. */
export function forbiddenPhrases(): { pattern: RegExp; why: string }[] {
  return PROHIBITED_PATTERNS;
}

export interface ProductLanguageVerdict {
  ok: boolean;
  /** Every prohibited claim found, so a caller can explain all of them rather than the first. */
  hits: ProhibitedClaimHit[];
}

/**
 * Check a string that is about to be shown to a person or published.
 *
 * A violation is reported, never silently rewritten: the caller decides whether to drop the
 * copy, block publication, or ask the author to change it.
 */
export function describeProductLanguage(text: string): ProductLanguageVerdict {
  const hits = scanForProhibitedClaims(text);
  return { ok: hits.length === 0, hits };
}

/**
 * Throw if a user-visible string would make a search-engine claim.
 *
 * Used on readiness copy and on the public site, so the Nexora Entity standard can never be
 * presented as a Google guarantee.
 */
export function assertNoSearchEngineGuarantee(text: string, where: string): void {
  const { hits } = describeProductLanguage(text);
  if (hits.length === 0) return;
  const reasons = [...new Set(hits.map((h) => h.why))].join('; ');
  throw new Error(`${where}: prohibited search-engine claim (${reasons})`);
}

export function scanForProhibitedClaims(text: string): ProhibitedClaimHit[] {
  const hits: ProhibitedClaimHit[] = [];
  for (const { pattern, why } of PROHIBITED_PATTERNS) {
    // Built with the global flag so every occurrence is examined, not just the first.
    const re = new RegExp(pattern.source, pattern.flags.includes('g') ? pattern.flags : `${pattern.flags}g`);
    for (const m of text.matchAll(re)) {
      if (m.index === undefined) continue;
      if (!isDisclaimed(text, m.index)) hits.push({ text, match: m[0], why });
    }
  }
  return hits;
}

/**
 * Wrap a user-facing readiness message so the Nexora Entity standard is always named and no
 * search-engine claim is implied. Used by every readiness surface.
 */
export function readinessLabel(percent: number, status: 'ready' | 'blocked' | 'running'): string {
  const pct = Math.max(0, Math.min(100, Math.round(percent)));
  const word = status === 'ready' ? 'READY' : status === 'running' ? 'REVIEWING' : 'BLOCKED';
  return `ENTITY READINESS: ${pct}% — ${word}`;
}

export const SEARCH_REALITY_NOTICE =
  'Nexora Entity is designed to make a person’s online identity more coherent, connected, attributable and understandable to search engines. Google independently decides what information appears in Search and how its Knowledge Graph and Knowledge Panels are created or updated. Nexora Entity has no access to, and makes no claim about, Google’s private internal Knowledge Graph state.';

export const VERIFIED_MEANING_NOTICE =
  '"Verified entity" means verified according to Nexora Entity’s own verification and Entity Readiness standards. It never means verification, approval or endorsement by Google or any other search engine.';