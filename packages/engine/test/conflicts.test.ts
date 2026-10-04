import { describe, expect, it } from 'vitest';
import { humanLabel, periodsOverlap } from '../src/conflicts';
import {
  detectNameCollision,
  detectThinEntity,
  runAmbiguityDetection,
  type AmbiguityInput,
} from '../src/ambiguity';
import { claim } from './fixtures';

/** A subject described well enough that no ambiguity check should fire. */
function richSubject(overrides: Partial<AmbiguityInput['subject']> = {}): AmbiguityInput['subject'] {
  return {
    names: ['Ada Lovelace'],
    aliases: ['Augusta Ada King'],
    professions: ['Mathematician'],
    organizations: ['Royal Society'],
    locations: ['London'],
    biography: 'English mathematician who wrote an algorithm intended for a machine.',
    handle: null,
    ...overrides,
  };
}

function richClaims() {
  return [
    claim({ attribute_key: 'identity.primaryName', value_text: 'Ada Lovelace' }),
    claim({ attribute_key: 'identity.alias', value_text: 'Augusta Ada King' }),
    claim({ attribute_key: 'identity.location', value_text: 'London' }),
    claim({ attribute_key: 'professional.profession', value_text: 'Mathematician' }),
    claim({ attribute_key: 'organizations.affiliation', value_text: 'Royal Society' }),
    claim({ attribute_key: 'projects.project', value_text: 'Analytical Engine notes' }),
  ];
}

const richInput: AmbiguityInput = {
  subject: richSubject(),
  claims: richClaims(),
  sources: [],
  identityLinks: [],
};

/** Nothing but a name. */
const bareInput: AmbiguityInput = {
  subject: { names: ['Chris Smith'], aliases: [], professions: [], organizations: [], locations: [] },
  claims: [claim({ attribute_key: 'identity.primaryName', value_text: 'Chris Smith' })],
  sources: [],
  identityLinks: [],
};

describe('temporal reasoning', () => {
  it('treats overlapping periods as the same moment', () => {
    expect(
      periodsOverlap(
        { start: '2020-01-01', end: '2022-01-01', current: false },
        { start: '2021-06-01', end: '2023-01-01', current: false },
      ),
    ).toBe(true);
  });

  it('treats a current role and a role that has ended as different moments', () => {
    // A current role and one that ended earlier are a career, not a contradiction.
    expect(
      periodsOverlap(
        { start: '2020-01-01', end: null, current: true },
        { start: '2018-01-01', end: '2020-01-01', current: false },
      ),
    ).toBe(false);
  });

  it('treats two closed periods in different years as separated', () => {
    expect(
      periodsOverlap(
        { start: '2015-01-01', end: '2016-01-01', current: false },
        { start: '2021-01-01', end: '2022-01-01', current: false },
      ),
    ).toBe(false);
  });

  it('treats an open-ended period as overlapping a later one', () => {
    // "From 2015" and "from 2021" are not necessarily sequential: either may still be running,
    // so the safe answer is that they could describe the same period.
    expect(
      periodsOverlap(
        { start: '2015-01-01', end: null, current: false },
        { start: '2021-01-01', end: null, current: false },
      ),
    ).toBe(true);
  });

  it('does not invent separation from unknown dates', () => {
    expect(periodsOverlap({ start: null, end: null, current: null }, { start: null, end: null, current: null })).toBe(true);
  });
});

describe('conflict labels', () => {
  it('names an attribute in human terms rather than as a key', () => {
    const label = humanLabel('identity.location');
    expect(label.length).toBeGreaterThan(0);
    expect(label).not.toContain('_');
  });

  it('still returns something readable for an unknown attribute', () => {
    expect(humanLabel('some.unknown.thing').length).toBeGreaterThan(0);
  });
});

describe('thin entity detection', () => {
  it('flags an entity described by nothing but a name', () => {
    expect(detectThinEntity(bareInput)).not.toBeNull();
  });

  it('does not flag a well-described entity', () => {
    expect(detectThinEntity(richInput)).toBeNull();
  });

  it('explains what is missing rather than only flagging', () => {
    const thin = detectThinEntity(bareInput);
    expect(thin?.missingEvidence.length ?? 0).toBeGreaterThan(0);
    expect(thin?.description.length ?? 0).toBeGreaterThan(10);
  });
});

describe('name collision detection', () => {
  it('finds nothing when there are no candidate sources to collide', () => {
    // A collision is about a specific other person whose profile looks similar, so with no
    // candidate sources there is nothing to compare against.
    expect(detectNameCollision(richInput)).toBeNull();
  });

  it('flags a candidate source carrying the same name but a weak identity match', () => {
    const withCandidate: AmbiguityInput = {
      ...bareInput,
      subject: { ...bareInput.subject, names: ['Chris Smith'] },
      sources: [{ id: 's9', url: 'https://others.example/chris-smith', title: 'Chris Smith', independence_group: 'others.example' }],
      identityLinks: [
        {
          source_id: 's9',
          resolved_state: 'uncertain',
          score: 0.3,
          signals: { name_compatibility: 0.9 },
          rationale: null,
          user_decision: null,
        },
      ],
    };
    const collision = detectNameCollision(withCandidate);
    expect(collision).not.toBeNull();
    expect(collision?.dimension).toBe('name_collision');
    expect(collision?.candidates[0]?.possibleCollision).toBe(true);
  });

  it('does not flag a candidate the person has already decided about', () => {
    const decided: AmbiguityInput = {
      ...bareInput,
      sources: [{ id: 's9', url: 'https://others.example/chris-smith', title: 'Chris Smith', independence_group: 'others.example' }],
      identityLinks: [
        {
          source_id: 's9',
          resolved_state: 'confirmed',
          score: 0.9,
          signals: { name_compatibility: 0.9 },
          rationale: null,
          user_decision: 'accept',
        },
      ],
    };
    expect(detectNameCollision(decided)).toBeNull();
  });
});

describe('ambiguity detection as a whole', () => {
  it('finds nothing wrong with a well-supported entity', () => {
    expect(runAmbiguityDetection(richInput, [])).toEqual([]);
  });

  it('reports an entity that is nothing but a name', () => {
    const found = runAmbiguityDetection(bareInput, []);
    expect(found.length).toBeGreaterThan(0);
    for (const ambiguity of found) {
      expect(ambiguity.dimension.length).toBeGreaterThan(0);
      expect(ambiguity.description.length).toBeGreaterThan(10);
      expect(['blocking', 'warning', 'info']).toContain(ambiguity.severity);
    }
  });

  it('never silently drops an ambiguity: every result carries its evidence', () => {
    for (const ambiguity of runAmbiguityDetection(bareInput, ['identity.location'])) {
      expect(Array.isArray(ambiguity.candidates)).toBe(true);
      expect(Array.isArray(ambiguity.missingEvidence)).toBe(true);
    }
  });
});
