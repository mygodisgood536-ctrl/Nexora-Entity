import { describe, expect, it } from 'vitest';
import { IdentityState } from '@nexora/core';
import type { ClaimRecord, SourceRecord } from '@nexora/db';
import {
  buildBreadcrumbs,
  buildMeta,
  buildPersonSchema,
  buildRobots,
  buildSitemap,
  confirmedProfileUrls,
  structuredDataFor,
  type PersonSchemaInput,
  type StructuredDataInput,
} from '../src/structured-data';

function claim(over: Partial<ClaimRecord>): ClaimRecord {
  return {
    id: 'c', entity_id: 'e', attribute_key: 'k', predicate: 'p', node_type: null,
    value_text: '', value_json: {}, normalized_key: null, origin: 'user',
    status: 'accepted_authoritative', support_strength: 'corroborated', authority_tier: 1,
    confidence: 0.9, source_id: null, independence_group: null, period_start: null,
    period_end: null, is_current: null, discovered_at: null, verified_at: null,
    last_checked_at: null, conflicting: false, conflict_ids: [], publish: true,
    user_confirmed: true, stage_key: null, display_label: null, sort_order: 0,
    created_at: new Date(), updated_at: new Date(),
    ...over,
  } as unknown as ClaimRecord;
}

function source(over: Partial<SourceRecord>): SourceRecord {
  return {
    id: 's1', url: 'https://github.com/torvalds', canonical_url: 'https://github.com/torvalds',
    source_type: 'social_profile', registrable_domain: 'github.com',
    ...over,
  } as unknown as SourceRecord;
}

const baseInput = (over: Partial<StructuredDataInput> = {}): StructuredDataInput => ({
  claims: [],
  sources: [],
  photos: [],
  identityLinks: [],
  ...over,
});

describe('structured data: never asserts unverified facts', () => {
  it('omits claims the person has not allowed to be published', () => {
    const s = structuredDataFor(
      baseInput({
        claims: [
          claim({ attribute_key: 'identity.primaryName', value_text: 'Linus Torvalds' }),
          claim({ attribute_key: 'identity.alias', value_text: 'Linus T', publish: false }),
        ],
      }),
    );
    expect(s.hasName).toBe(true);
    expect(s.alternateNames).toBe(0);
  });

  it('omits rejected and conflicting claims', () => {
    const s = structuredDataFor(
      baseInput({
        claims: [
          claim({ attribute_key: 'identity.primaryName', value_text: 'Linus Torvalds' }),
          claim({ attribute_key: 'identity.alias', value_text: 'Bad', status: 'rejected' }),
          claim({ attribute_key: 'identity.alias', value_text: 'Also bad', status: 'conflicting' }),
        ],
      }),
    );
    expect(s.alternateNames).toBe(0);
  });

  it('reports description only when real biography text is published', () => {
    expect(structuredDataFor(baseInput()).description).toBe(false);
    const some = structuredDataFor(
      baseInput({ claims: [claim({ attribute_key: 'about.biography', value_text: 'Creator of Linux.' })] }),
    );
    expect(some.description).toBe(true);
  });

  it('requires a qualifying uploaded photo before claiming an image', () => {
    expect(structuredDataFor(baseInput({ photos: [{ qualifies: false } as never] })).image).toBe(false);
    expect(structuredDataFor(baseInput({ photos: [{ qualifies: true } as never] })).image).toBe(true);
  });
});

describe('structured data: sameAs requires a confirmed identity', () => {
  it('excludes a profile whose identity was never confirmed', () => {
    const urls = confirmedProfileUrls(
      baseInput({
        sources: [source({ id: 's1' })],
        identityLinks: [{ source_id: 's1', resolved_state: IdentityState.uncertain, user_decision: null }],
      }),
    );
    expect(urls).toEqual([]);
  });

  it('includes a deterministically confirmed profile', () => {
    const urls = confirmedProfileUrls(
      baseInput({
        sources: [source({ id: 's1' })],
        identityLinks: [{ source_id: 's1', resolved_state: IdentityState.confirmed, user_decision: null }],
      }),
    );
    expect(urls).toEqual(['https://github.com/torvalds']);
  });

  it("honours the person's explicit accept and reject decisions", () => {
    expect(
      confirmedProfileUrls(
        baseInput({
          sources: [source({ id: 's1' })],
          identityLinks: [{ source_id: 's1', resolved_state: IdentityState.uncertain, user_decision: 'accept' }],
        }),
      ),
    ).toHaveLength(1);
    expect(
      confirmedProfileUrls(
        baseInput({
          sources: [source({ id: 's1' })],
          identityLinks: [{ source_id: 's1', resolved_state: IdentityState.confirmed, user_decision: 'reject' }],
        }),
      ),
    ).toEqual([]);
  });

  it('does not duplicate the same canonical URL', () => {
    const urls = confirmedProfileUrls(
      baseInput({
        sources: [source({ id: 'a' }), source({ id: 'b' })],
        identityLinks: [
          { source_id: 'a', resolved_state: IdentityState.confirmed, user_decision: null },
          { source_id: 'b', resolved_state: IdentityState.confirmed, user_decision: null },
        ],
      }),
    );
    expect(urls).toHaveLength(1);
  });
});

describe('Person schema.org output', () => {
  const personInput = (over: Partial<PersonSchemaInput> = {}): PersonSchemaInput => ({
    ...baseInput(),
    entityUid: 'nexora:entity:abc',
    canonicalUrl: 'https://example.com/e/abc',
    images: [],
    location: null,
    contact: null,
    ...over,
  });

  const personNode = (over: Partial<PersonSchemaInput> = {}) => {
    const graph = buildPersonSchema(personInput(over));
    return graph['@graph'].find((n) => n['@type'] === 'Person') as Record<string, unknown>;
  };

  it('emits a Person node carrying the stable identifier and canonical URL', () => {
    const person = personNode();
    expect(person['@type']).toBe('Person');
    expect(person.name).toBeNull(); // nothing published to assert yet
    expect(person.identifier).toBe('nexora:entity:abc');
    expect(person.url).toBe('https://example.com/e/abc');
  });

  it('carries name, alternate names and occupations from published claims', () => {
    const person = personNode({
      claims: [
        claim({ attribute_key: 'identity.primaryName', value_text: 'Linus Torvalds' }),
        claim({ attribute_key: 'identity.alias', value_text: 'Linus T' }),
        claim({ attribute_key: 'professional.profession', value_text: 'Software engineer' }),
      ],
    });
    expect(person.name).toBe('Linus Torvalds');
    expect(person.alternateName).toEqual(['Linus T']);
    expect(person.hasOccupation).toEqual([{ '@type': 'Occupation', name: 'Software engineer' }]);
  });

  it('omits sameAs entirely when no profile has been confirmed', () => {
    const person = personNode({
      sources: [source({ id: 's1' })],
      identityLinks: [{ source_id: 's1', resolved_state: IdentityState.uncertain, user_decision: null }],
    });
    expect(person.sameAs).toBeUndefined();
  });

  it('includes sameAs only for confirmed profiles', () => {
    const person = personNode({
      sources: [source({ id: 's1' })],
      identityLinks: [{ source_id: 's1', resolved_state: IdentityState.confirmed, user_decision: null }],
    });
    expect(person.sameAs).toEqual(['https://github.com/torvalds']);
  });

  it('never emits a profile the person explicitly rejected', () => {
    // §23/§30: a rejection by the person overrides any algorithmic state.
    const person = personNode({
      sources: [source({ id: 's1' })],
      identityLinks: [{ source_id: 's1', resolved_state: IdentityState.confirmed, user_decision: 'reject' }],
    });
    expect(person.sameAs).toBeUndefined();
  });

  it('represents a qualified primary image as an ImageObject', () => {
    const person = personNode({
      images: [{ url: 'https://example.com/me.jpg', alt: 'Portrait', isPrimary: true }],
    });
    expect(person.image).toEqual({ '@type': 'ImageObject', url: 'https://example.com/me.jpg', caption: 'Portrait' });
  });

  it('produces a graph containing both a Person and a ProfilePage', () => {
    const graph = buildPersonSchema(personInput());
    expect(graph['@context']).toBe('https://schema.org');
    expect(graph['@graph'].some((n) => n['@type'] === 'ProfilePage')).toBe(true);
  });
});

describe('SEO metadata and crawl files', () => {
  const metaFor = (published: boolean) =>
    buildMeta({
      name: 'Ada', headline: null, description: null,
      canonicalUrl: 'https://example.com/e/ada', imageUrl: null,
      published, alternateNames: 0,
    });

  it('blocks crawlers until the entity is published', () => {
    expect(metaFor(false).robots).toContain('noindex');
    expect(buildRobots({ sitemapUrl: 'https://example.com/sitemap.xml', published: false })).toContain('Disallow: /');
  });

  it('allows crawling and points at the sitemap once published', () => {
    expect(metaFor(true).robots).toContain('index');
    expect(buildRobots({ sitemapUrl: 'https://example.com/sitemap.xml', published: true })).toContain('Sitemap:');
  });

  it('emits valid XML with escaped images in the sitemap', () => {
    const xml = buildSitemap({
      canonicalUrl: 'https://example.com/e/ada',
      lastModified: '2026-01-01T00:00:00.000Z',
      images: [{ url: 'https://example.com/a.jpg?x=1&y=2', title: 'Ada & Co' }],
    });
    expect(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>')).toBe(true);
    expect(xml).toContain('<image:loc>https://example.com/a.jpg?x=1&amp;y=2</image:loc>');
    expect(xml).toContain('<image:title>Ada &amp; Co</image:title>');
    expect(xml).toContain('</urlset>');
  });

  it('emits ordered breadcrumb positions', () => {
    const bc = buildBreadcrumbs([{ name: 'Home', url: '/' }, { name: 'Work', url: '/work' }]);
    expect(bc['@type']).toBe('BreadcrumbList');
    expect((bc.itemListElement as { position: number }[]).map((i) => i.position)).toEqual([1, 2]);
  });
});
