import { describe, expect, it } from 'vitest';
import { STANDARD_NOTICE } from '../src/model';
import { composeEntitySite, firstSentence, navigationFor, type ComposeInput } from '../src/compose';
import type { EntitySiteModel } from '../src/model';

/** A complete, publishable entity. Individual tests remove exactly one thing at a time. */
function completeInput(overrides: Partial<ComposeInput> = {}): ComposeInput {
  return {
    entityUid: 'nxr_ada_0001',
    canonicalUrl: 'https://ada.example',
    publishedFacts: {
      primaryName: 'Ada Lovelace',
      fullName: 'Augusta Ada King',
      alternateNames: ['Augusta Ada King', 'Ada King'],
      headline: 'Mathematician',
      shortBio: 'Wrote the first algorithm intended for a machine.',
      biography:
        'Ada Lovelace was an English mathematician whose notes on the Analytical Engine included an algorithm often described as the first published computer program. She corresponded with Charles Babbage and translated his work into French.',
      knownFor: 'The first published algorithm intended for a machine.',
      expertise: ['Algorithms', 'Mathematics'],
      location: 'London, United Kingdom',
      professions: ['Mathematician'],
      titles: ['Analyst'],
      specialisations: ['Computing history'],
      services: [],
      industries: ['Mathematics'],
      currentCompany: 'The Analytical Engine project',
      founderStatus: null,
      currentFocus: 'Annotation of the Analytical Engine diagrams',
      careers: [{ text: 'Analyst, Analytical Engine', period: '1843', current: false, url: null }],
      education: [{ text: 'Private tuition in mathematics', period: null, current: false, url: null }],
      skills: ['Algorithms', 'Mathematics'],
      languages: ['English', 'French'],
      subjectAreas: ['Mathematics'],
      organizations: [{ text: 'Royal Society', period: null, current: false, url: null }],
      projects: [{ text: 'Notes on the Analytical Engine', period: '1843', current: false, url: null }],
      products: [{ text: 'Bernoulli Numbers translation', period: '1842', current: false, url: null }],
      achievements: [{ text: 'Royal Society recognition', period: null, current: false, url: null }],
      publications: [{ text: 'Sketch of the Analytical Engine', period: '1843', current: false, url: null }],
      dates: ['1843'],
      other: [],
    },
    photos: [
      { url: 'https://ada.example/portrait.jpg', alt: 'Ada Lovelace', width: 1200, height: 1600, caption: 'Portrait', isPrimary: true },
      { url: 'https://ada.example/engraving.jpg', alt: 'Engraving', width: 900, height: 1100, caption: null, isPrimary: false },
    ],
    profiles: [{ label: 'GitHub', url: 'https://github.com/example', kind: 'profile', host: 'github.com' }],
    websites: [
      { label: 'Personal site', url: 'https://ada.example', kind: 'website', host: 'ada.example' },
      { label: 'Biography', url: 'https://biography.example/ada', kind: 'page', host: 'biography.example' },
    ],
    press: [
      { label: 'Profile', url: 'https://news.example/ada', kind: 'press', host: 'news.example' },
      { label: 'Feature', url: 'https://journal.example/ada', kind: 'press', host: 'journal.example' },
    ],
    contact: null,
    lastUpdated: '2026-01-15T00:00:00.000Z',
    published: true,
    ...overrides,
  };
}

const sectionIds = (model: EntitySiteModel) => model.sections.map((s) => s.id);

describe('compose: the standard notice', () => {
  it('is attached to every published model', () => {
    const model = composeEntitySite(completeInput());
    expect(model.standardNotice).toBe(STANDARD_NOTICE);
  });

  it('distinguishes Nexora Entity verification from any search engine', () => {
    expect(STANDARD_NOTICE).toContain('Nexora Entity');
    expect(STANDARD_NOTICE.toLowerCase()).not.toContain('google');
    expect(STANDARD_NOTICE).toContain('not a guarantee');
  });
});

/** Every fact field emptied, plus no photos or links: a genuinely barren entity. */
function barrenInput(overrides: Partial<ComposeInput> = {}): ComposeInput {
  const facts = completeInput().publishedFacts;
  return completeInput({
    publishedFacts: {
      ...facts,
      primaryName: null,
      fullName: null,
      alternateNames: [],
      headline: null,
      shortBio: null,
      biography: null,
      knownFor: null,
      expertise: [],
      location: null,
      professions: [],
      titles: [],
      specialisations: [],
      services: [],
      industries: [],
      currentCompany: null,
      founderStatus: null,
      currentFocus: null,
      careers: [],
      education: [],
      skills: [],
      languages: [],
      subjectAreas: [],
      organizations: [],
      projects: [],
      products: [],
      achievements: [],
      publications: [],
      dates: [],
      other: [],
    },
    photos: [],
    profiles: [],
    websites: [],
    press: [],
    ...overrides,
  });
}

describe('compose: sections reflect real content', () => {
  it('leads with the full public name, as Stage A collects it', () => {
    // Stage A asks for "the exact name you publish under" and says the public site leads with
    // it, so the composer must not quietly prefer a different name.
    const model = composeEntitySite(completeInput());
    expect(model.name).toBe('Augusta Ada King');
    expect(model.headline).toBe('Mathematician');
    expect(model.sections.length).toBeGreaterThan(5);
  });

  it('keeps the primary name as an alternate rather than dropping it', () => {
    const model = composeEntitySite(completeInput());
    expect(model.alternateNames).toContain('Ada Lovelace');
  });

  it('falls back to the primary name when no full public name was given', () => {
    const facts = completeInput().publishedFacts;
    const model = composeEntitySite(completeInput({ publishedFacts: { ...facts, fullName: null } }));
    expect(model.name).toBe('Ada Lovelace');
  });

  it('never emits an empty section', () => {
    // Remove biography, skills and projects, then confirm no section is left without content.
    const facts = completeInput().publishedFacts;
    const model = composeEntitySite(
      completeInput({
        publishedFacts: { ...facts, biography: null, shortBio: null, skills: [], projects: [], languages: [], subjectAreas: [] },
      }),
    );
    for (const section of model.sections) {
      const hasContent = section.entries.length > 0 || (section.body ?? '').trim().length > 0;
      expect(hasContent).toBe(true);
    }
  });

  it('drops the about section when there is no prose at all', () => {
    // Every field the section could draw on is emptied: no biography, no summary, no headline,
    // no known-for line, no biography-derived body, and no photos to caption.
    const facts = completeInput().publishedFacts;
    const model = composeEntitySite(
      completeInput({
        publishedFacts: {
          ...facts,
          biography: null,
          shortBio: null,
          knownFor: null,
          headline: null,
          expertise: [],
          specialisations: [],
          skills: [],
          languages: [],
          subjectAreas: [],
          professions: [],
          titles: [],
          industries: [],
          currentCompany: null,
          currentFocus: null,
          founderStatus: null,
        },
        photos: [],
      }),
    );
    expect(sectionIds(model)).not.toContain('about');
  });

  it('keeps sections that still have content after one fact is removed', () => {
    const facts = completeInput().publishedFacts;
    const model = composeEntitySite(completeInput({ publishedFacts: { ...facts, skills: [] } }));
    expect(sectionIds(model)).toContain('about');
  });

  it('marks a draft that is not published', () => {
    const model = composeEntitySite(completeInput({ published: false }));
    expect(model.published).toBe(false);
  });
});

describe('compose: no invented content', () => {
  it('contains no placeholder or filler text anywhere', () => {
    const model = composeEntitySite(completeInput());
    const serialised = JSON.stringify(model).toLowerCase();
    for (const banned of ['lorem', 'ipsum', 'todo', 'tbd', 'placeholder', 'coming soon', 'xxx', 'example text']) {
      expect(serialised).not.toContain(banned);
    }
  });

  it('produces no sections at all when there is no verified information', () => {
    const empty = composeEntitySite(barrenInput());
    expect(empty.sections).toEqual([]);
  });

  it('never emits a section without content, at any level of completeness', () => {
    // Every partial input in between must also be free of empty sections.
    const facts = completeInput().publishedFacts;
    const variants = [
      { ...facts, biography: null, shortBio: null },
      { ...facts, skills: [], languages: [], subjectAreas: [] },
      { ...facts, careers: [], education: [], organizations: [] },
      { ...facts, projects: [], products: [], achievements: [], publications: [] },
      { ...facts, expertise: [], professions: [], titles: [], industries: [] },
    ];
    for (const variant of variants) {
      for (const photos of [[], completeInput().photos]) {
        const model = composeEntitySite(completeInput({ publishedFacts: variant, photos }));
        for (const section of model.sections) {
          const hasContent = section.entries.length > 0 || (section.body ?? '').trim().length > 0;
          expect(hasContent).toBe(true);
        }
      }
    }
  });

  it('does not publish an unverified fact that was not handed to it', () => {
    // The composer only ever renders what it is given; it must not reach back for anything.
    const model = composeEntitySite(completeInput());
    expect(JSON.stringify(model)).not.toContain('Grace Hopper');
  });
});

describe('compose: links', () => {
  it('carries every confirmed profile, website and press link', () => {
    const model = composeEntitySite(completeInput());
    const urls = JSON.stringify(model);
    expect(urls).toContain('github.com/example');
    expect(urls).toContain('news.example/ada');
  });

  it('carries every confirmed website and profile into the presence section', () => {
    const model = composeEntitySite(completeInput());
    const presence = model.sections.find((s) => s.id === 'presence');
    expect((presence?.entries ?? []).length).toBeGreaterThan(0);
    expect(model.websites.length).toBe(2);
    expect(model.profiles.length).toBe(1);
  });

  it('labels each link rather than showing a raw URL as the link text', () => {
    const model = composeEntitySite(completeInput());
    const presence = model.sections.find((s) => s.id === 'presence');
    for (const entry of presence?.entries ?? []) {
      expect(entry.title.length).toBeGreaterThan(0);
      if (entry.url) expect(entry.title).not.toContain(entry.url);
    }
  });

  it('emits no presence section when given no links', () => {
    const model = composeEntitySite(completeInput({ websites: [], profiles: [], press: [] }));
    expect(model.sections.find((s) => s.id === 'presence')).toBeUndefined();
    expect(model.websites).toEqual([]);
    expect(model.profiles).toEqual([]);
  });

  it('de-duplicates links that point at the same place', () => {
    const dupe: ComposeInput['websites'][number] = {
      label: 'Personal site',
      url: 'https://ada.example/',
      kind: 'website',
      host: 'ada.example',
    };
    const model = composeEntitySite(completeInput({ websites: [dupe, { ...dupe, label: 'Same site' }] }));
    const presence = model.sections.find((s) => s.id === 'presence');
    const adaEntries = (presence?.entries ?? []).filter((e) => e.url?.includes('ada.example'));
    expect(adaEntries.length).toBe(1);
  });
});

describe('navigation', () => {
  it('lists only sections that exist', () => {
    const model = composeEntitySite(completeInput());
    const nav = navigationFor(model);
    const ids = new Set(sectionIds(model));
    for (const item of nav) expect(ids.has(item.href.replace('#', ''))).toBe(true);
  });

  it('is empty for an entity with no sections', () => {
    expect(navigationFor(composeEntitySite(barrenInput()))).toEqual([]);
  });
});

describe('firstSentence', () => {
  it('takes the opening sentence', () => {
    expect(firstSentence('One. Two. Three.')).toBe('One.');
  });

  it('returns null for empty or missing text', () => {
    expect(firstSentence(null)).toBeNull();
    expect(firstSentence('   ')).toBeNull();
  });

  it('does not break on text with no sentence break', () => {
    expect(firstSentence('No full stop here')).toBe('No full stop here');
  });
});
