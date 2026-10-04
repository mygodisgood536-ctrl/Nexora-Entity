import { describe, expect, it } from 'vitest';
import type { InspectionResult } from '@nexora/inspect';
import { SourceType } from '@nexora/core';
import { assessDuplicate, authorityTierFor, qualifySource, subjectRelevance, type QualifierInput, type SubjectProfile } from '../src/qualify';

const SUBJECT: SubjectProfile = {
  names: ['Ada Lovelace'],
  aliases: ['Augusta Ada King'],
  professions: ['mathematician'],
  organizations: ['royal society'],
  projects: ['analytical engine'],
  locations: ['london'],
  handle: null,
  ownedDomains: ['ada.example'],
  biography: 'English mathematician who wrote an algorithm for the Analytical Engine.',
};

function inspection(overrides: Partial<InspectionResult> = {}): InspectionResult {
  return {
    url: 'https://ada.example/about',
    finalUrl: 'https://ada.example/about',
    httpStatus: 200,
    redirects: [],
    contentType: 'text/html',
    accessStatus: 'accessible',
    accessDetail: null,
    inspected: true,
    checkError: null,
    title: 'Ada Lovelace',
    description: 'About Ada Lovelace, mathematician.',
    author: 'Ada Lovelace',
    publishedDate: null,
    modifiedDate: null,
    textExcerpt: 'Ada Lovelace was an English mathematician who wrote notes on the Analytical Engine in London.',
    textLength: 2400,
    contentHash: 'c'.repeat(64),
    extracted: {
      names: ['Ada Lovelace'],
      alternateNames: [],
      headline: 'Mathematician',
      organisation: 'Royal Society',
      location: 'London',
      description: 'About Ada Lovelace',
      images: [],
      profileLinks: [],
      sameAs: [],
      jsonLdTypes: ['Person'],
      keywords: [],
      emails: [],
      isArticle: false,
      articlePublisher: null,
      loginWall: false,
      challengePage: false,
      headings: ['Ada Lovelace'],
    },
    platform: null,
    platformHandle: null,
    platformNote: null,
    platformData: null,
    isPersonalSite: true,
    elapsedMs: 300,
    ...overrides,
  };
}

/** A live, readable page that says nothing about the subject, on a foreign domain. */
function unrelatedPage(url = 'https://others.example/someone'): InspectionResult {
  return inspection({
    url,
    finalUrl: url,
    title: 'Grace Hopper',
    description: 'A biography of Grace Hopper, computer scientist.',
    author: 'Grace Hopper',
    textExcerpt: 'Grace Hopper worked on compilers and naval computing systems in New York.',
    extracted: {
      ...inspection().extracted,
      names: ['Grace Hopper'],
      alternateNames: [],
      headline: 'Rear Admiral',
      organisation: 'US Navy',
      location: 'New York',
      description: 'A biography of Grace Hopper.',
      // Headings are part of the evidence haystack, so a leftover subject heading would count.
      headings: ['Grace Hopper'],
    },
  });
}

function input(overrides: Partial<QualifierInput> = {}): QualifierInput {
  return {
    url: 'https://ada.example/about',
    inspection: inspection(),
    sourceType: SourceType.selfAuthoredSite,
    declaredKind: 'website',
    declaredAsWebsite: true,
    ...overrides,
  };
}

/** `qualifySource` needs the subject profile as well as the source. */
function qualify(overrides: Partial<QualifierInput> = {}) {
  return qualifySource({ ...input(overrides), subject: SUBJECT });
}

describe('authorityTierFor', () => {
  it('ranks a directly authorised source highest', () => {
    expect(authorityTierFor(SourceType.directAuthorized)).toBe(6);
  });

  it('ranks an independent publication above a self-authored site', () => {
    // Press is independent corroboration; the person's own site is self-assertion.
    expect(authorityTierFor(SourceType.independentPublication)).toBeGreaterThan(
      authorityTierFor(SourceType.selfAuthoredSite),
    );
  });

  it('ranks a social profile above a self-declared one', () => {
    expect(authorityTierFor(SourceType.socialProfile)).toBeGreaterThan(
      authorityTierFor(SourceType.selfDeclaredProfile),
    );
  });

  it('gives an unknown type the lowest authority rather than the highest', () => {
    expect(authorityTierFor('something_unrecognised' as SourceType)).toBe(2);
  });
});

describe('subjectRelevance', () => {
  it('scores a page that names the subject highly', () => {
    const r = subjectRelevance({ inspection: inspection(), subject: SUBJECT });
    expect(r.score).toBeGreaterThan(0.55);
    expect(r.matched.length).toBeGreaterThan(0);
  });

  it('scores a page about someone else near zero', () => {
    const r = subjectRelevance({ inspection: unrelatedPage(), subject: SUBJECT });
    expect(r.score).toBeLessThan(0.55);
    expect(r.matched).toEqual([]);
  });

  it('treats a page on a domain the person declared as their own as authoritative', () => {
    const r = subjectRelevance({
      inspection: inspection({ url: 'https://ada.example/about', finalUrl: 'https://ada.example/about' }),
      subject: SUBJECT,
    });
    expect(r.score).toBe(1);
  });

  it('catches an alias as well as the primary name', () => {
    const r = subjectRelevance({
      inspection: inspection({
        title: 'Augusta Ada King',
        textExcerpt: 'Augusta Ada King, also known as Ada Lovelace, was a mathematician.',
        extracted: { ...inspection().extracted, names: ['Augusta Ada King'] },
      }),
      subject: SUBJECT,
    });
    expect(r.score).toBeGreaterThan(0.55);
  });

  it('stays within range for an empty page', () => {
    const r = subjectRelevance({
      inspection: inspection({
        title: null,
        description: null,
        author: null,
        textExcerpt: null,
        extracted: { ...inspection().extracted, names: [], headline: null, organisation: null, location: null },
      }),
      subject: SUBJECT,
    });
    expect(r.score).toBeGreaterThanOrEqual(0);
    expect(r.score).toBeLessThanOrEqual(1);
  });
});

describe('qualifySource: unreachable sources never qualify', () => {
  for (const [status, expected] of [
    ['not_found', 'dead link'],
    ['network_error', 'could not be reached'],
    ['timeout', 'timed out'],
    ['blocked', 'blocked'],
    ['private', 'sign-in'],
  ] as const) {
    it(`refuses a source that is ${status}`, () => {
      const r = qualify({ inspection: inspection({ accessStatus: status, inspected: false }) });
      expect(r.qualifiesWebsites).toBe(false);
      expect(r.qualifiesPress).toBe(false);
      expect(r.blockers.join(' ').toLowerCase()).toContain(expected);
    });
  }

  it('refuses a page that returned a bot-protection challenge', () => {
    const r = qualify({ inspection: inspection({ extracted: { ...inspection().extracted, challengePage: true } }) });
    expect(r.qualifiesWebsites).toBe(false);
    expect(r.blockers.join(' ')).toContain('bot-protection');
  });

  it('refuses a source that is not about the subject', () => {
    const page = unrelatedPage();
    const r = qualify({ url: page.url ?? 'https://others.example/someone', inspection: page });
    expect(r.qualifiesWebsites).toBe(false);
    expect(r.blockers.join(' ')).toContain('does not mention the person');
  });
});

describe('qualifySource: a good source qualifies', () => {
  it('qualifies the person\'s own site as a website', () => {
    const r = qualify();
    expect(r.qualifiesWebsites).toBe(true);
    expect(r.subjectRelevance).toBeGreaterThan(0.55);
    expect(r.reasons.length).toBeGreaterThan(0);
  });

  it('does not count a personal site as press', () => {
    expect(qualify().qualifiesPress).toBe(false);
  });

  it('assigns an independence group based on the registrable domain', () => {
    const r = qualify();
    expect(r.independenceGroup.length).toBeGreaterThan(0);
    // A subdomain of an owned domain must land in the same group as the apex.
    const sub = qualify({ url: 'https://blog.ada.example/post', inspection: inspection({ url: 'https://blog.ada.example/post' }) });
    expect(sub.independenceGroup).toBe(r.independenceGroup);
  });

  it('groups identical content together, even on different domains', () => {
    // This is deliberate and is what makes syndication detectable: four outlets carrying the same
    // press release must land in one independence group, not four.
    const a = qualify({ url: 'https://ada.example/a', inspection: inspection({ url: 'https://ada.example/a', finalUrl: 'https://ada.example/a' }) });
    const b = qualify({ url: 'https://news.example/a', inspection: inspection({ url: 'https://news.example/a', finalUrl: 'https://news.example/a' }) });
    expect(a.independenceGroup).toBe(b.independenceGroup);
  });

  it('keeps genuinely different pages in separate independence groups', () => {
    const a = qualify({
      url: 'https://ada.example/a',
      inspection: inspection({
        url: 'https://ada.example/a',
        finalUrl: 'https://ada.example/a',
        textExcerpt: 'Ada Lovelace wrote notes on the Analytical Engine, a mechanical general-purpose computer.',
      }),
    });
    const b = qualify({
      url: 'https://news.example/b',
      inspection: inspection({
        url: 'https://news.example/b',
        finalUrl: 'https://news.example/b',
        textExcerpt: 'Completely unrelated words about a different subject and a different topic entirely.',
      }),
    });
    expect(a.independenceGroup).not.toBe(b.independenceGroup);
  });

  it('keeps a quality score inside 0..1', () => {
    const r = qualify();
    expect(r.qualityScore).toBeGreaterThanOrEqual(0);
    expect(r.qualityScore).toBeLessThanOrEqual(1);
  });
});

describe('qualifySource: press', () => {
  const pressInspection = (overrides: Partial<InspectionResult> = {}) =>
    inspection({
      title: 'Profile: Ada Lovelace, the first programmer',
      description: 'A profile of Ada Lovelace published by an independent outlet.',
      isArticle: true,
      ...overrides,
      extracted: {
        ...inspection().extracted,
        ...(overrides.extracted ?? {}),
      },
    } as Partial<InspectionResult>);

  it('qualifies an independent article as press', () => {
    const r = qualify({
      url: 'https://news.example/profile',
      inspection: pressInspection({ url: 'https://news.example/profile', finalUrl: 'https://news.example/profile' }),
      sourceType: SourceType.independentPublication,
      declaredKind: 'press_release',
      declaredAsPress: true,
      declaredAsWebsite: false,
    });
    expect(r.qualifiesPress).toBe(true);
  });

  it('does not count a self-authored page as press', () => {
    const r = qualify({ declaredAsPress: true, declaredKind: 'press_release' });
    expect(r.qualifiesPress).toBe(false);
  });
});

describe('assessDuplicate', () => {
  const candidate = {
    id: 'c1',
    url: 'https://ada.example/about',
    independenceGroup: 'ada.example',
    inspection: inspection(),
  };
  const longBody = 'Ada Lovelace wrote notes on the Analytical Engine. '.repeat(20);
  const candidateWithBody = {
    id: 'c1',
    url: 'https://ada.example/profile',
    independenceGroup: 'ada.example',
    inspection: inspection({
      url: 'https://ada.example/profile',
      finalUrl: 'https://ada.example/profile',
      title: 'Profile of Ada Lovelace',
      textExcerpt: longBody,
    }),
  };

  it('does not call a source a duplicate when there is nothing to compare it to', () => {
    const result = assessDuplicate(candidate, []);
    expect(result.duplicateOfId).toBeNull();
    expect(result.reason.length).toBeGreaterThan(0);
  });

  it('flags an identical copy republished on another site', () => {
    const result = assessDuplicate(candidateWithBody, [
      {
        id: 's1',
        url: 'https://mirror.example/copied',
        textExcerpt: longBody,
        independenceGroup: 'mirror.example',
        title: 'Profile of Ada Lovelace',
      },
    ]);
    expect(result.duplicateOfId).toBe('s1');
    expect(result.similarity).toBeGreaterThan(0.82);
    expect(result.reason).toMatch(/copy|identical/i);
  });

  it('flags a copy published on the same domain', () => {
    const result = assessDuplicate(candidateWithBody, [
      {
        id: 's1',
        url: 'https://blog.ada.example/copied',
        textExcerpt: longBody,
        independenceGroup: 'ada.example',
        title: 'Profile of Ada Lovelace',
      },
    ]);
    expect(result.duplicateOfId).toBe('s1');
    expect(result.sameDomain).toBe(true);
  });

  it('does not flag genuinely different content', () => {
    const result = assessDuplicate(candidate, [
      {
        id: 's1',
        url: 'https://news.example/another-story',
        textExcerpt: 'Completely different words about an unrelated topic, covering other subjects.',
        independenceGroup: 'news.example',
        title: 'Another story',
      },
    ]);
    expect(result.duplicateOfId).toBeNull();
  });

  it('never flags a source as a duplicate of itself', () => {
    const result = assessDuplicate(candidate, [
      {
        id: 'c1',
        url: 'https://ada.example/about',
        textExcerpt: longBody,
        independenceGroup: 'ada.example',
        title: 'Ada Lovelace',
      },
    ]);
    expect(result.duplicateOfId).toBeNull();
  });
});
