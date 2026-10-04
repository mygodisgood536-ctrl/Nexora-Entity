import { describe, expect, it } from 'vitest';
import { IdentityState } from '@nexora/core';
import type { ClaimRecord } from '@nexora/db';
import {
  detectNameCollision,
  detectSplitPerson,
  detectThinEntity,
  runAmbiguityDetection,
  type AmbiguityInput,
} from '../src/ambiguity';

const subject = {
  names: ['Linus Torvalds'],
  aliases: [],
  professions: [],
  organizations: [],
  locations: [],
  biography: null,
  handle: null,
};

const input = (over: Partial<AmbiguityInput> = {}): AmbiguityInput => ({
  subject: { ...subject },
  claims: [] as ClaimRecord[],
  sources: [],
  identityLinks: [],
  ...over,
});

const link = (over: Partial<AmbiguityInput['identityLinks'][number]>) => ({
  source_id: 's1',
  resolved_state: IdentityState.uncertain,
  score: 0.4,
  signals: { name_compatibility: 0.8 },
  rationale: null,
  user_decision: null,
  ...over,
});

describe('ambiguity: a thin entity is not yet distinguishable', () => {
  it('flags an entity carrying almost nothing as blocking', () => {
    const a = detectThinEntity(input());
    expect(a).not.toBeNull();
    expect(a!.severity).toBe('blocking');
    expect(a!.dimension).toBe('insufficient_distinction');
  });

  it('names the specific evidence that would resolve it, in plain language', () => {
    const a = detectThinEntity(input())!;
    expect(a.missingEvidence.length).toBeGreaterThan(0);
    for (const line of a.missingEvidence) expect(line.length).toBeGreaterThan(20);
  });

  it('accepts a well-differentiated entity', () => {
    const a = detectThinEntity(
      input({
        subject: {
          names: ['Linus Torvalds'],
          aliases: ['Linus T'],
          professions: ['Software engineer'],
          organizations: ['Linux Foundation'],
          locations: ['Portland, USA'],
          biography: 'Creator of the Linux kernel, a long free software collaboration maintained worldwide.',
          handle: 'torvalds',
        },
      }),
    );
    expect(a).toBeNull();
  });

  it('does not treat one lone attribute as sufficient distinction', () => {
    // A single profession is not enough to tell two people apart (spec §14).
    const a = detectThinEntity(
      input({ subject: { ...subject, professions: ['Software engineer'] } }),
    );
    expect(a).not.toBeNull();
  });
});

describe('ambiguity: a name-only match is a possible collision', () => {
  it('flags a source whose title is exactly the subject name but which scored low', () => {
    const a = detectNameCollision(
      input({
        sources: [{ id: 's1', url: 'https://other.example/l', title: 'Linus Torvalds', independence_group: null }],
        identityLinks: [link({})],
      }),
    );
    expect(a).not.toBeNull();
    expect(a!.candidates[0].possibleCollision).toBe(true);
  });

  it('ignores a collision the person has already decided on', () => {
    const a = detectNameCollision(
      input({
        sources: [{ id: 's1', url: 'https://other.example/l', title: 'Linus Torvalds', independence_group: null }],
        identityLinks: [link({ user_decision: 'reject' })],
      }),
    );
    expect(a).toBeNull();
  });

  it('ignores a source with no name signal at all', () => {
    const a = detectNameCollision(
      input({
        sources: [{ id: 's1', url: 'https://other.example/l', title: 'Someone Else', independence_group: null }],
        identityLinks: [link({ signals: {}, score: 0.1 })],
      }),
    );
    expect(a).toBeNull();
  });
});

describe('ambiguity: unresolved disagreement reads as two people', () => {
  it('is blocking when a disagreement is still open', () => {
    const a = detectSplitPerson(
      input({
        sources: [{ id: 's1', url: 'https://a.example', title: 'A', independence_group: null }],
        identityLinks: [link({})],
      }),
      ['career.currentRole'],
    );
    expect(a).not.toBeNull();
    expect(a!.severity).toBe('blocking');
    expect(a!.missingEvidence.length).toBeGreaterThan(0);
  });

  it('is clear once nothing is disputed', () => {
    expect(
      detectSplitPerson(
        input({
          sources: [{ id: 's1', url: 'https://a.example', title: 'A', independence_group: null }],
          identityLinks: [link({})],
        }),
        [],
      ),
    ).toBeNull();
  });

  it('ignores sources already confirmed as the subject', () => {
    expect(
      detectSplitPerson(
        input({
          sources: [{ id: 's1', url: 'https://a.example', title: 'A', independence_group: null }],
          identityLinks: [link({ resolved_state: IdentityState.confirmed })],
        }),
        ['career.currentRole'],
      ),
    ).toBeNull();
  });
});

describe('ambiguity: the combined run aggregates every dimension', () => {
  it('reports all three dimensions when all three apply', () => {
    const out = runAmbiguityDetection(
      input({
        sources: [{ id: 's1', url: 'https://other.example/l', title: 'Linus Torvalds', independence_group: null }],
        identityLinks: [link({})],
      }),
      ['career.currentRole'],
    );
    const dims = out.map((a) => a.dimension);
    expect(dims).toContain('insufficient_distinction');
    expect(dims).toContain('name_collision');
    expect(dims).toContain('split_person');
  });

  it('reports nothing for a healthy, unambiguous, fully-distinguished entity', () => {
    const out = runAmbiguityDetection(
      input({
        subject: {
          names: ['Linus Torvalds'], aliases: ['Linus T'], professions: ['Engineer'],
          organizations: ['Linux Foundation'], locations: ['Portland'],
          biography: 'Creator of the Linux kernel and a long-standing open source maintainer.',
          handle: 'torvalds',
        },
        sources: [{ id: 's1', url: 'https://linux.org', title: 'Linux', independence_group: 'linux.org' }],
        identityLinks: [link({ resolved_state: IdentityState.confirmed, score: 0.95, signals: { location: 1 } })],
      }),
      [],
    );
    expect(out).toEqual([]);
  });
});
