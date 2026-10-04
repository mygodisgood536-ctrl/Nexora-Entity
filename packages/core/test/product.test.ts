import { describe, expect, it } from 'vitest';
import { NexoraError, toActionableError } from '../src/errors';
import { STAGES, getStage, isStageKey, stageOrder } from '../src/stages';
import {
  assertNoSearchEngineGuarantee,
  describeProductLanguage,
  forbiddenPhrases,
  readinessLabel,
  SEARCH_REALITY_NOTICE,
  VERIFIED_MEANING_NOTICE,
} from '../src/product-language';
import { PRODUCT_NAME } from '../src/vocabulary';

describe('product name', () => {
  it('is the exact product name', () => {
    expect(PRODUCT_NAME).toBe('Nexora Entity');
  });
});

describe('stage registry', () => {
  it('covers every stage from A to W with no gaps', () => {
    const keys = STAGES.map((s) => s.key);
    expect(keys.length).toBe(23);
    for (let i = 0; i < keys.length; i += 1) {
      expect(keys[i]?.startsWith(String.fromCharCode(65 + i))).toBe(true);
    }
  });

  it('gives every stage a unique key, letter, title, and explanation', () => {
    expect(new Set(STAGES.map((s) => s.key)).size).toBe(STAGES.length);
    expect(new Set(STAGES.map((s) => s.letter)).size).toBe(STAGES.length);
    expect(new Set(STAGES.map((s) => s.title)).size).toBe(STAGES.length);
    for (const stage of STAGES) {
      expect(stage.title.length).toBeGreaterThan(0);
      expect(stage.summary.length).toBeGreaterThan(0);
      // whyItMatters is what the completeness engine quotes when explaining a gap.
      expect(stage.whyItMatters.length).toBeGreaterThan(0);
      expect(stage.skipCopy.length).toBeGreaterThan(0);
    }
  });

  it('gives every stage a requirement from the known set', () => {
    const allowed = ['material', 'evidence_minimum', 'recommended', 'optional'];
    for (const stage of STAGES) {
      expect(allowed).toContain(stage.requirement);
    }
  });

  it('marks the three evidence-minimum stages the readiness gate depends on', () => {
    // The internal Nexora Entity standard requires at least 5 qualifying websites, 4 qualifying
    // press releases, and 4 qualifying photos. Those three stages are therefore evidence-bearing
    // and the readiness gate reads them directly.
    expect(getStage('N_websites')?.requirement).toBe('evidence_minimum');
    expect(getStage('M_press_releases')?.requirement).toBe('evidence_minimum');
    expect(getStage('Q_photos')?.requirement).toBe('evidence_minimum');
  });

  it('treats name variants as material, since identity matching depends on them', () => {
    expect(getStage('B_name_variants')?.requirement).toBe('material');
  });

  it('does not make descriptive stages block readiness', () => {
    // Recommended stages enrich the entity but cannot gate publication.
    for (const key of ['G_skills', 'I_projects', 'W_other']) {
      expect(['recommended', 'optional']).toContain(getStage(key)?.requirement);
    }
  });

  it('resolves a known stage key', () => {
    expect(getStage('A_identity')?.key).toBe('A_identity');
    expect(getStage('N_websites')?.key).toBe('N_websites');
  });

  it('returns nothing for an unknown stage key', () => {
    expect(getStage('Z_nope' as never)).toBeUndefined();
  });

  it('recognises valid keys and rejects invalid ones', () => {
    expect(isStageKey('A_identity')).toBe(true);
    expect(isStageKey('Z_nope')).toBe(false);
    expect(isStageKey('')).toBe(false);
  });

  it('reports progress as an ordered subset of stages', () => {
    const done = stageOrder(['A_identity', 'C_about']);
    expect(done).toEqual(['A_identity', 'C_about']);
  });
});

describe('product language guard', () => {
  it('rejects a Google endorsement claim', () => {
    const result = describeProductLanguage('Your entity is verified by Google and appears in the Knowledge Panel.');
    expect(result.ok).toBe(false);
  });

  it('rejects implying official Google partnership', () => {
    expect(describeProductLanguage('Official Google partner for entity verification.').ok).toBe(false);
    expect(describeProductLanguage('Certified by Google.').ok).toBe(false);
  });

  it('rejects guaranteeing a Knowledge Panel', () => {
    expect(describeProductLanguage('We will get you a Knowledge Panel.').ok).toBe(false);
    expect(describeProductLanguage('Guaranteed panel placement.').ok).toBe(false);
  });

  it('rejects promising a search ranking', () => {
    expect(describeProductLanguage('You will rank first on Google.').ok).toBe(false);
  });

  it('accepts language that keeps the Nexora Entity standard distinct from Google', () => {
    // The guard rejects a claim, not the mere word "Google": a sentence that explicitly
    // disclaims Google approval must be allowed through.
    const result = describeProductLanguage(
      'This meets the Nexora Entity Readiness Standard. It is not a Google approval or endorsement.',
    );
    expect(result.ok).toBe(true);
  });

  it('accepts the published search-reality notice', () => {
    expect(describeProductLanguage(SEARCH_REALITY_NOTICE).ok).toBe(true);
  });

  it('accepts the published meaning-of-verified notice', () => {
    expect(describeProductLanguage(VERIFIED_MEANING_NOTICE).ok).toBe(true);
  });

  it('exposes the forbidden phrases it checks for', () => {
    expect(forbiddenPhrases().length).toBeGreaterThan(0);
  });

  it('refuses to let a prohibited string through the assertion guard', () => {
    expect(() => assertNoSearchEngineGuarantee('This is Google verified.', 'readiness')).toThrow();
    expect(() => assertNoSearchEngineGuarantee('Meets the Nexora Entity Readiness Standard.', 'readiness')).not.toThrow();
  });

  it('names the Nexora Entity standard in its readiness label', () => {
    const label = readinessLabel(62, 'blocked');
    expect(label).toContain('ENTITY READINESS');
    expect(label).toContain('62%');
    expect(label).toContain('BLOCKED');
    expect(label).not.toContain('Google');
  });

  it('clamps an out-of-range percentage', () => {
    expect(readinessLabel(-10, 'ready')).toContain('0%');
    expect(readinessLabel(180, 'ready')).toContain('100%');
  });
});

describe('NexoraError', () => {
  it('derives an HTTP status from its domain', () => {
    expect(new NexoraError({ code: 'x', domain: 'user_data', message: 'm' }).status).toBe(400);
    expect(new NexoraError({ code: 'x', domain: 'auth', message: 'm' }).status).toBe(401);
  });

  it('always preserves user progress', () => {
    expect(new NexoraError({ code: 'x', domain: 'system', message: 'm' }).preservesUserProgress).toBe(true);
  });

  it('always offers at least one action', () => {
    expect(new NexoraError({ code: 'x', domain: 'system', message: 'm' }).remediation.length).toBeGreaterThan(0);
  });

  it('serialises to a stable, credential-free shape', () => {
    // Constructed via an unexpected throw, which is the path that can carry a credential.
    const json = toActionableError(new Error('rejected token=sk-live-ABCDEFGHIJ'));
    expect(JSON.stringify(json)).not.toContain('sk-live-ABCDEFGHIJ');
    expect(json.preservesUserProgress).toBe(true);
    expect(json.occurredAt).toBeTruthy();
  });
});