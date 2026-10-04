/**
 * AI orchestration through OpenCode (Amendment section 9).
 *
 * The account's verified provider/model powers these operations. AI output is ADVISORY: it can
 * propose candidates for the person to review, explain reasoning and summarise, but it can
 * never satisfy an evidence minimum, override the readiness gate, change authentication,
 * permissions, persistence or deployment rules, or turn an unresolved item into a fact.
 */

import { createLogger, truncate } from '@nexora/core';
import { runStructured, type ModelRef } from '@nexora/opencode-bridge';
import type { InspectionResult } from '@nexora/inspect';

const log = createLogger('engine:ai');

export const AI_SYSTEM = `You are the analysis component of Nexora Entity, a digital-identity and entity-readiness platform.

Absolute rules:
- Never invent, assume, or fabricate any fact, name, source, date, verification, relationship or achievement. If you do not know, say you do not know.
- Never assert that Google, Bing or any search engine has verified, approved, endorsed or recognised anyone. You have no knowledge of any search engine's private internal knowledge graph.
- Never treat two similar names as evidence that two profiles belong to the same person. Similarity alone is never sufficient.
- Distinguish carefully between: information the person supplied; information discovered from an external source; information independently supported by more than one independent source; information that is uncertain; information that conflicts; and information Nexora Entity has accepted as authoritative.
- Respect source independence: several pages copying one press release are one source, not several.
- Answer with the requested JSON only.`;

export interface DiscoveredCandidate {
  type:
    | 'biography_fact'
    | 'organisation'
    | 'project'
    | 'product'
    | 'achievement'
    | 'publication'
    | 'alias'
    | 'title'
    | 'skill'
    | 'contact'
    | 'other';
  value: string;
  confidence: 'low' | 'medium' | 'high';
  /** The exact source text that supports this candidate. Never paraphrased into existence. */
  evidenceQuote: string;
  sourceUrl: string | null;
  note: string;
}

const CANDIDATE_SCHEMA = `{
  "candidates": [
    {
      "type": "biography_fact | organisation | project | product | achievement | publication | alias | title | skill | contact | other",
      "value": "short factual value",
      "confidence": "low | medium | high",
      "evidenceQuote": "the exact words in the source that support this",
      "sourceUrl": "url of the source, or null",
      "note": "why you think this is about the subject person"
    }
  ]
}`;

function parseCandidates(value: unknown): DiscoveredCandidate[] | null {
  if (!value || typeof value !== 'object') return null;
  const arr = (value as { candidates?: unknown }).candidates;
  if (!Array.isArray(arr)) return null;
  const out: DiscoveredCandidate[] = [];
  for (const item of arr) {
    if (!item || typeof item !== 'object') continue;
    const o = item as Record<string, unknown>;
    const v = typeof o['value'] === 'string' ? o['value'].trim() : '';
    if (!v) continue;
    const confidence = ['low', 'medium', 'high'].includes(String(o['confidence']))
      ? (String(o['confidence']) as DiscoveredCandidate['confidence'])
      : 'low';
    out.push({
      type: (typeof o['type'] === 'string' ? o['type'] : 'other') as DiscoveredCandidate['type'],
      value: truncate(v, 400),
      confidence,
      evidenceQuote: typeof o['evidenceQuote'] === 'string' ? truncate(o['evidenceQuote'].trim(), 600) : '',
      sourceUrl: typeof o['sourceUrl'] === 'string' ? o['sourceUrl'] : null,
      note: typeof o['note'] === 'string' ? truncate(o['note'].trim(), 400) : '',
    });
  }
  return out;
}

/** Ask the model to find candidate facts in an inspected source. All are queued for review. */
export async function discoverCandidatesFromSource(input: {
  model: ModelRef;
  subject: { names: string[]; aliases: string[]; professions: string[]; organizations: string[] };
  source: { url: string; title: string | null; textExcerpt: string | null };
  inspection: InspectionResult;
}): Promise<DiscoveredCandidate[]> {
  const result = await runStructured(
    input.model,
    {
      operation: 'source_discovery',
      system: AI_SYSTEM,
      instruction: [
        'Read the source below and identify concrete facts about the subject person.',
        `Subject names: ${input.subject.names.join(', ')}`,
        input.subject.aliases.length ? `Subject other names: ${input.subject.aliases.join(', ')}` : '',
        input.subject.professions.length ? `Subject professions: ${input.subject.professions.join(', ')}` : '',
        `Source URL: ${input.source.url}`,
        `Source title: ${input.source.title ?? '(none)'}`,
        '',
        'Rules for this task:',
        '- Only report a fact if the source text actually states it.',
        '- Include the exact supporting words in evidenceQuote. If you cannot quote support, omit the item.',
        '- Only report facts about the subject person, not about other people mentioned.',
        '- Do not report the existence of a social profile or website itself as a fact about the person.',
      ]
        .filter(Boolean)
        .join('\n'),
      payload: {
        pageText: truncate(input.inspection.textExcerpt ?? '', 6000),
        pageTitle: input.inspection.title,
        pageDescription: input.inspection.description,
        structuredDataNames: input.inspection.extracted.names,
        structuredDataHeadline: input.inspection.extracted.headline,
        platformFacts: input.inspection.platformData?.facts ?? null,
      },
      schemaHint: CANDIDATE_SCHEMA,
    },
    parseCandidates,
  );
  log.info('AI discovery returned candidates', { source: input.source.url, count: result.value.length });
  return result.value;
}

const AMBIGUITY_SCHEMA = `{
  "couldDescribeMultiplePeople": true,
  "reason": "why",
  "missingDistinguishingEvidence": ["what would resolve it"],
  "suggestedQuestions": ["questions to ask the user"]
}`;

export interface AmbiguityAssessment {
  couldDescribeMultiplePeople: boolean;
  reason: string;
  missingDistinguishingEvidence: string[];
  suggestedQuestions: string[];
}

function parseAmbiguity(v: unknown): AmbiguityAssessment | null {
  if (!v || typeof v !== 'object') return null;
  const o = v as Record<string, unknown>;
  if (typeof o['couldDescribeMultiplePeople'] !== 'boolean') return null;
  const strArr = (k: string): string[] =>
    Array.isArray(o[k]) ? (o[k] as unknown[]).filter((x): x is string => typeof x === 'string') : [];
  return {
    couldDescribeMultiplePeople: o['couldDescribeMultiplePeople'],
    reason: typeof o['reason'] === 'string' ? o['reason'] : '',
    missingDistinguishingEvidence: strArr('missingDistinguishingEvidence'),
    suggestedQuestions: strArr('suggestedQuestions'),
  };
}

/** Advisory second opinion on whether the collected information is unambiguous. */
export async function assessAmbiguity(input: {
  model: ModelRef;
  entityName: string;
  claims: { attributeKey: string; value: string; origin: string; status: string }[];
  sources: { url: string; title: string | null; accessStatus: string; qualifies: boolean }[];
  deterministicFindings: { dimension: string; description: string }[];
}): Promise<AmbiguityAssessment | null> {
  const result = await runStructured(
    input.model,
    {
      operation: 'ambiguity_assessment',
      system: AI_SYSTEM,
      instruction: [
        'You are the second reviewer in a final entity review.',
        'Question: could the information collected so far reasonably describe more than one real person?',
        '',
        'Be strict. If two different real people could both be described by this information, the answer is true.',
        'Do not raise a concern merely because a field is empty, only because a plausible alternative person exists.',
        'Never suggest that any search engine has verified or approved this person.',
      ].join('\n'),
      payload: {
        entityName: input.entityName,
        claims: input.claims.slice(0, 300),
        sources: input.sources.slice(0, 120),
        deterministicFindings: input.deterministicFindings,
      },
      schemaHint: AMBIGUITY_SCHEMA,
    },
    parseAmbiguity,
  );
  return result.value;
}

const READINESS_SCHEMA = `{
  "verdict": "ready",
  "headline": "one sentence in plain language",
  "whatIsMissing": ["the most important missing things, in plain language"],
  "whatIsUncertain": ["things that are not yet solid"],
  "encouragement": "one supportive sentence"
}`;

export interface ReadinessNarrative {
  verdict: 'ready' | 'blocked';
  headline: string;
  whatIsMissing: string[];
  whatIsUncertain: string[];
  encouragement: string;
}

function parseReadiness(v: unknown): ReadinessNarrative | null {
  if (!v || typeof v !== 'object') return null;
  const o = v as Record<string, unknown>;
  const verdict = o['verdict'] === 'ready' ? 'ready' : o['verdict'] === 'blocked' ? 'blocked' : null;
  if (!verdict) return null;
  const strArr = (k: string): string[] =>
    Array.isArray(o[k]) ? (o[k] as unknown[]).filter((x): x is string => typeof x === 'string') : [];
  return {
    verdict,
    headline: typeof o['headline'] === 'string' ? o['headline'] : '',
    whatIsMissing: strArr('whatIsMissing'),
    whatIsUncertain: strArr('whatIsUncertain'),
    encouragement: typeof o['encouragement'] === 'string' ? o['encouragement'] : '',
  };
}

/**
 * Turn a deterministic readiness report into plain language. This never changes the verdict:
 * the deterministic gate is authoritative.
 */
export async function narrateReadiness(input: {
  model: ModelRef;
  entityName: string;
  deterministicStatus: 'ready' | 'blocked';
  score: number;
  blockingIssues: { title: string; detail: string; action: string }[];
  warnings: { title: string; detail: string }[];
  completenessNarrative: string;
}): Promise<ReadinessNarrative | null> {
  const result = await runStructured(
    input.model,
    {
      operation: 'readiness_narration',
      system: AI_SYSTEM,
      instruction: [
        'Explain this Entity Readiness result to the person in warm, plain, non-technical language.',
        '',
        'Rules:',
        '- Entity Readiness is Nexora Entity’s own internal standard of completeness and internal coherence.',
        '- Never mention or imply Google verification, Google approval, or a guaranteed Knowledge Panel.',
        '- Never claim the platform knows any search engine internal state.',
        '- Say exactly what is missing and where to go. Do not invent new requirements.',
      ].join('\n'),
      payload: {
        entityName: input.entityName,
        score: input.score,
        deterministicVerdict: input.deterministicStatus,
        blockingIssues: input.blockingIssues.slice(0, 12),
        warnings: input.warnings.slice(0, 8),
        completeness: input.completenessNarrative,
      },
      schemaHint: READINESS_SCHEMA,
    },
    parseReadiness,
  );
  return { ...result.value, verdict: input.deterministicStatus };
}

const ALIAS_SCHEMA = `{
  "aliases": [
    { "value": "a name form", "why": "what makes this a legitimate variant" }
  ]
}`;

function parseAliases(v: unknown): { value: string; why: string }[] | null {
  if (!v || typeof v !== 'object') return null;
  const arr = (v as { aliases?: unknown }).aliases;
  if (!Array.isArray(arr)) return null;
  const out: { value: string; why: string }[] = [];
  for (const item of arr) {
    if (!item || typeof item !== 'object') continue;
    const o = item as Record<string, unknown>;
    const value = typeof o['value'] === 'string' ? o['value'].trim() : '';
    if (!value || value.length > 120) continue;
    out.push({ value, why: typeof o['why'] === 'string' ? o['why'].trim() : '' });
  }
  return out;
}

/** Suggest legitimate name variants found in sources. Never auto-applied. */
export async function suggestAliases(input: {
  model: ModelRef;
  entityName: string;
  knownNames: string[];
  observedNames: { name: string; sourceUrl: string }[];
}): Promise<{ value: string; why: string }[]> {
  if (input.observedNames.length === 0) return [];
  const result = await runStructured(
    input.model,
    {
      operation: 'alias_suggestion',
      system: AI_SYSTEM,
      instruction: [
        'Below are names observed on the person public sources.',
        'Identify only legitimate name variants of the same person: nicknames, reordered names, dropped middle names, professional or stage names, shortened forms, or a single-name public identity.',
        '',
        'Hard rules:',
        '- A different person name is NOT an alias. If the name could belong to somebody else, leave it out.',
        '- Never propose a name that is merely similar.',
        '- Do not propose anything already listed as a known name.',
      ].join('\n'),
      payload: {
        entityName: input.entityName,
        knownNames: input.knownNames,
        observedNames: input.observedNames.slice(0, 60),
      },
      schemaHint: ALIAS_SCHEMA,
    },
    parseAliases,
  );
  const known = new Set(input.knownNames.map((n) => n.toLowerCase().trim()));
  return result.value.filter((a) => !known.has(a.value.toLowerCase().trim()));
}
