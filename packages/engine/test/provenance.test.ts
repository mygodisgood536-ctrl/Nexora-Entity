import { describe, expect, it } from 'vitest';
import { factsFromSource, factKey, provenanceStats } from '../src/provenance';
import type { ClaimRecord, SourceRecord } from '@nexora/db';

/** A source record that genuinely came back from an inspection. */
function inspectedSource(overrides: Partial<SourceRecord> = {}): SourceRecord {
  return {
    id: 'src-1',
    entity_id: 'ent-1',
    inspection_status: 'inspected',
    independence_group: 'group-a',
    registrable_domain: 'example.com',
    quality_score: 0.8,
    canonical_url: 'https://example.com/about',
    url: 'https://example.com/about',
    extracted: {
      organisation: 'Example Foundation',
      location: 'Helsinki, Finland',
      description: 'A software engineer known for creating large open source kernels.',
      headline: 'Linus Torvalds — Creator of Linux',
      alternateNames: ['Linus T'],
      sameAs: ['https://github.com/torvalds'],
      emails: ['public@example.com'],
    },
    ...overrides,
  } as unknown as SourceRecord;
}

function claim(overrides: Partial<ClaimRecord>): ClaimRecord {
  return {
    id: 'c1',
    entity_id: 'ent-1',
    attribute_key: 'discovered.organisation',
    value_text: 'Example Foundation',
    origin: 'discovered',
    support_strength: 'single_source',
    status: 'sourced',
    source_id: 'src-1',
    ...overrides,
  } as unknown as ClaimRecord;
}

describe('provenance: reading facts out of inspected sources', () => {
  it('extracts only what the source actually states', () => {
    const facts = factsFromSource(inspectedSource());
    const keys = facts.map((f) => f.attributeKey);
    expect(keys).toContain('discovered.organisation');
    expect(keys).toContain('discovered.location');
    expect(keys).toContain('discovered.description');
    expect(keys).toContain('discovered.headline');
    expect(keys).toContain('discovered.alternateName');
    expect(keys).toContain('discovered.sameAs');
    expect(keys).toContain('discovered.email');
  });

  it('produces no provenance at all from a source that was never inspected', () => {
    // We did not read it, so we must not claim anything about it.
    for (const status of ['failed', 'skipped', 'pending', 'inspecting'] as const) {
      const facts = factsFromSource(inspectedSource({ inspection_status: status }));
      expect(facts).toEqual([]);
    }
  });

  it('produces no provenance from an inspected source that yielded nothing usable', () => {
    const facts = factsFromSource(
      inspectedSource({ extracted: { headline: null, organisation: '', description: '', emails: [] } }),
    );
    expect(facts).toEqual([]);
  });

  it('rejects malformed emails and non-http links rather than recording them', () => {
    const facts = factsFromSource(
      inspectedSource({ extracted: { emails: ['not-an-email', 'a@b.co'], sameAs: ['javascript:void(0)'] } }),
    );
    expect(facts.filter((f) => f.attributeKey === 'discovered.email').map((f) => f.valueText)).toEqual(['a@b.co']);
    expect(facts.filter((f) => f.attributeKey === 'discovered.sameAs')).toEqual([]);
  });

  it('keeps only links on plausible profile hosts', () => {
    // A page's sameAs list is mostly nav and archives; only the person's own profiles count
    // as evidence about them. Anything else would flood the claim table.
    const facts = factsFromSource(
      inspectedSource({
        extracted: {
          sameAs: [
            'https://github.com/torvalds',
            'https://en.wikipedia.org/wiki/Linus_Torvalds',
            'https://random-shop.example/cart',
            'https://cdn.example.com/asset.js',
          ],
        },
      }),
    );
    expect(facts.filter((f) => f.attributeKey === 'discovered.sameAs').map((f) => f.valueText)).toEqual([
      'https://github.com/torvalds',
      'https://en.wikipedia.org/wiki/Linus_Torvalds',
    ]);
  });

  it('caps a link-heavy page instead of importing every link it can see', () => {
    const many = Array.from({ length: 200 }, (_, i) => `https://github.com/user${i}`);
    const facts = factsFromSource(inspectedSource({ extracted: { sameAs: many } }));
    expect(facts.filter((f) => f.attributeKey === 'discovered.sameAs')).toHaveLength(12);
  });

  it('does not treat a one-word fragment as a description', () => {
    const facts = factsFromSource(inspectedSource({ extracted: { description: 'Hi' } }));
    expect(facts.filter((f) => f.attributeKey === 'discovered.description')).toEqual([]);
  });
});

describe('provenance: independence grouping', () => {
  it('groups identical assertions so independent sources can corroborate each other', () => {
    expect(factKey('discovered.organisation', 'Example Foundation')).toBe(
      factKey('discovered.organisation', '  example   foundation '),
    );
  });

  it('keeps different attributes apart', () => {
    expect(factKey('discovered.organisation', 'Acme')).not.toBe(factKey('discovered.location', 'Acme'));
  });
});

describe('provenance: measuring the chain', () => {
  it('counts discovered claims as externally sourced, which is what readiness measures', () => {
    const stats = provenanceStats([
      claim({}),
      claim({ id: 'c2', origin: 'user', support_strength: 'self_asserted', status: 'user_provided', source_id: null }),
    ]);
    expect(stats.total).toBe(2);
    expect(stats.externallySourced).toBe(1);
    expect(stats.selfAssertedOnly).toBe(1);
  });

  it('counts corroborated claims', () => {
    const stats = provenanceStats([
      claim({ support_strength: 'corroborated' }),
      claim({ id: 'c2', support_strength: 'strongly_supported' }),
    ]);
    expect(stats.corroborated).toBe(2);
  });

  it('counts claims that carry source evidence', () => {
    const stats = provenanceStats([
      claim({ source_id: 'src-1' }),
      claim({ id: 'c2', origin: 'user', source_id: null }),
    ]);
    expect(stats.withEvidenceCapableProvenance).toBe(1);
  });
});
