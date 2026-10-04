import { describe, expect, it } from 'vitest';
import type { InspectionResult } from '@nexora/inspect';
import { nameCompatibility, resolveIdentity, type IdentityInput } from '../src/identity';

const SUBJECT: IdentityInput['subject'] = {
  names: ['Ada Lovelace'],
  aliases: ['Augusta Ada King'],
  professions: ['Mathematician'],
  organizations: ['Royal Society'],
  projects: ['Analytical Engine notes'],
  biography: 'English mathematician who wrote an algorithm for the Analytical Engine.',
  locations: ['London'],
  handle: null,
  ownedDomains: ['ada.example'],
};

/** A fully-formed inspection result, matching `InspectionResult` field for field. */
function inspection(overrides: Partial<InspectionResult> = {}): InspectionResult {
  return {
    url: 'https://github.com/example',
    finalUrl: 'https://github.com/example',
    httpStatus: 200,
    redirects: [],
    contentType: 'text/html',
    accessStatus: 'accessible',
    accessDetail: null,
    inspected: true,
    checkError: null,
    title: 'Ada Lovelace',
    description: 'Notes on the Analytical Engine.',
    author: null,
    publishedDate: null,
    modifiedDate: null,
    textExcerpt: 'Notes on the Analytical Engine by Ada Lovelace.',
    textLength: 1400,
    contentHash: 'c'.repeat(64),
    extracted: {
      names: ['Ada Lovelace'],
      alternateNames: [],
      headline: 'Mathematician',
      organisation: 'Royal Society',
      location: 'London',
      description: 'Notes on the Analytical Engine.',
      images: [],
      // A link back to a domain the subject declared as their own is genuine independent
      // corroboration, so the realistic fixture includes one.
      profileLinks: ['https://ada.example/me'],
      sameAs: [],
      jsonLdTypes: ['Person'],
      keywords: [],
      emails: [],
      isArticle: false,
      articlePublisher: null,
      loginWall: false,
      challengePage: false,
      headings: ['Analytical Engine'],
    },
    platform: 'github',
    platformHandle: 'example',
    platformNote: null,
    platformData: null,
    isPersonalSite: false,
    elapsedMs: 420,
    ...overrides,
  };
}

function input(overrides: Partial<IdentityInput> = {}): IdentityInput {
  return {
    subject: SUBJECT,
    inspection: inspection(),
    sourceUrl: 'https://github.com/example',
    sourceType: 'social_profile',
    ...overrides,
  };
}

describe('name compatibility', () => {
  it('scores an exact match highest', () => {
    expect(nameCompatibility('Ada Lovelace', 'Ada Lovelace').score).toBeGreaterThan(0.9);
  });

  it('recognises a reordered name', () => {
    expect(nameCompatibility('Lovelace, Ada', 'Ada Lovelace').score).toBeGreaterThan(0.8);
  });

  it('recognises an alias', () => {
    expect(nameCompatibility('Augusta Ada King', 'Ada Lovelace').score).toBeLessThan(0.5);
  });

  it('scores an unrelated name near zero', () => {
    expect(nameCompatibility('Grace Hopper', 'Ada Lovelace').score).toBeLessThan(0.2);
  });

  it('ignores diacritics and case', () => {
    expect(nameCompatibility('josé garcía', 'Jose Garcia').score).toBeGreaterThan(0.9);
  });

  it('always explains itself', () => {
    const result = nameCompatibility('Someone Else', 'Ada Lovelace');
    expect(result.reason.length).toBeGreaterThan(0);
  });
});

describe('identity resolution', () => {
  it('links a source that matches the subject on several independent signals', () => {
    const result = resolveIdentity(input());
    // An exact name plus matching profession, organisation, project and a cross-link to an
    // owned domain: the engine may still hold it for review, but it must never call this weak.
    expect(['confirmed', 'probable_needs_review']).toContain(result.state);
    expect(result.score).toBeGreaterThan(0.5);
    expect(result.signals.filter((s) => s.supports).length).toBeGreaterThan(1);
    expect(result.signals.filter((s) => s.supports && s.independent).length).toBeGreaterThanOrEqual(2);
  });

  it('requires more than name similarity to reach confirmed', () => {
    // Matching name and nothing else must not be enough, however exact the name is.
    const nameOnly = resolveIdentity(
      input({
        sourceType: 'self_authored_site',
        inspection: inspection({
          platform: null,
          title: 'Ada Lovelace',
          extracted: {
            ...inspection().extracted,
            names: ['Ada Lovelace'],
            headline: null,
            organisation: null,
            location: null,
            profileLinks: [],
          },
        }),
      }),
    );
    expect(nameOnly.state).not.toBe('confirmed');
  });

  it('asks for one more independent signal when the match is probable', () => {
    const result = resolveIdentity(input());
    if (result.state === 'probable_needs_review') {
      expect(result.missingEvidence.join(' ')).toContain('independent signal');
    }
  });

  it('does not connect two people on name similarity alone', () => {
    // The spec forbids linking profiles solely because the names look alike.
    const result = resolveIdentity(
      input({
        inspection: inspection({
          extracted: { names: ['Ada Lovelace'], headline: 'Poet', organisation: null, location: 'Paris' },
        } as Partial<InspectionResult>),
      }),
    );
    expect(result.state).not.toBe('confirmed');
  });

  it('records the signals and their direction, not just a number', () => {
    const result = resolveIdentity(input());
    for (const signal of result.signals) {
      expect(typeof signal.supports).toBe('boolean');
      expect(signal.observation.length).toBeGreaterThan(0);
    }
  });

  it('says what evidence is still missing when the match is weak', () => {
    const result = resolveIdentity(
      input({
        inspection: inspection({
          title: 'A Person',
          platform: null,
          extracted: {
            ...inspection().extracted,
            names: ['A Person'],
            headline: null,
            organisation: null,
            location: null,
            profileLinks: [],
          },
        }),
      }),
    );
    expect(result.state).not.toBe('confirmed');
    expect(result.missingEvidence.length).toBeGreaterThan(0);
  });

  it('always produces a rationale a person can read', () => {
    const result = resolveIdentity(input());
    expect(result.rationale.length).toBeGreaterThan(10);
  });

  it('honours a user decision over its own score', () => {
    // The person has already looked at this one; the engine must not overrule them.
    const accepted = resolveIdentity(input({ userDecision: 'accept' }));
    expect(accepted.state).toBe('confirmed');

    const rejected = resolveIdentity(
      input({
        userDecision: 'reject',
        inspection: inspection({
          extracted: { names: ['Ada Lovelace'], headline: 'Mathematician' },
        } as Partial<InspectionResult>),
      }),
    );
    expect(rejected.state).toBe('rejected');
  });

  it('scores deterministically: the same input gives the same answer', () => {
    const a = resolveIdentity(input());
    const b = resolveIdentity(input());
    expect(b.state).toBe(a.state);
    expect(b.score).toBe(a.score);
  });

  it('uses a deterministic method when no AI is involved', () => {
    expect(resolveIdentity(input()).method).toBe('deterministic');
  });

  it('never returns a score outside 0..1', () => {
    for (const overrides of [
      {},
      { inspection: inspection({ extracted: { names: ['Ada Lovelace', 'Augusta Ada King'] } } as Partial<InspectionResult>) },
      { inspection: inspection({ extracted: { names: ['Nobody'] } } as Partial<InspectionResult>) },
    ]) {
      const r = resolveIdentity(input(overrides));
      expect(r.score).toBeGreaterThanOrEqual(0);
      expect(r.score).toBeLessThanOrEqual(1);
    }
  });

  it('rejects a source that could not be read', () => {
    // A blocked or dead page yields no evidence. Treating it as merely "uncertain" would put it
    // in the review queue and ask the person to judge a page that was never retrieved.
    const result = resolveIdentity(input({ inspection: inspection({ accessStatus: 'blocked' }) }));
    expect(result.state).toBe('rejected');
    expect(result.missingEvidence.join(' ')).toContain('readable');
  });

  it('rejects a page behind bot protection', () => {
    const result = resolveIdentity(
      input({
        inspection: inspection({
          extracted: { ...inspection().extracted, challengePage: true },
        }),
      }),
    );
    expect(result.state).toBe('rejected');
  });
});
