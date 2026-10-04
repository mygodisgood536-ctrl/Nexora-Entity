import { describe, expect, it } from 'vitest';
import { detectConflicts } from '../src/conflicts';
import type { ClaimRecord } from '@nexora/db';
import { claim } from './fixtures';

/**
 * Regression: the pipeline process terminated during conflict detection.
 *
 * `discovered.*` claims are observations read out of inspected sources. Because their
 * attribute keys appeared in none of the conflict engine's classification sets, every pair of
 * them fell through to `valueContradiction`. With the real e2e subject that produced 1,216
 * fabricated conflicts — 1,038 from `discovered.sameAs` alone — and roughly 5,000 database
 * writes, which exhausted the connection pool and killed the run.
 */

const discovered = (attributeKey: string, valueText: string, over: Partial<ClaimRecord> = {}) =>
  claim({ attribute_key: attributeKey, value_text: valueText, origin: 'discovered', status: 'sourced', ...over });

describe('conflict detection: discovered observations accumulate, they do not conflict', () => {
  it('treats different profile URLs as multiple profiles, not a contradiction', () => {
    const conflicts = detectConflicts({
      claims: [
        discovered('discovered.sameAs', 'https://github.com/torvalds'),
        discovered('discovered.sameAs', 'https://mastodon.social/@LinusTorvalds'),
        discovered('discovered.sameAs', 'https://bsky.app/profile/torvalds.org'),
      ],
      sourceMeta: {},
    });
    expect(conflicts).toEqual([]);
  });

  it('treats different published emails as multiple addresses, not a contradiction', () => {
    const conflicts = detectConflicts({
      claims: [
        discovered('discovered.email', 'torvalds@kernel.org'),
        discovered('discovered.email', 'press@kernel.org'),
        discovered('discovered.email', 'security@kernel.org'),
      ],
      sourceMeta: {},
    });
    expect(conflicts).toEqual([]);
  });

  it('never treats differently-worded source prose as a contradiction', () => {
    const conflicts = detectConflicts({
      claims: [
        discovered('discovered.description', 'Linus Torvalds is a Finnish-American software engineer.'),
        discovered('discovered.description', 'Creator of the Linux kernel and a vocal open source advocate.'),
        discovered('discovered.headline', 'Creator of Linux'),
        discovered('discovered.headline', 'Linux kernel maintainer'),
      ],
      sourceMeta: {},
    });
    expect(conflicts).toEqual([]);
  });

  it('produces a bounded conflict count for a realistic discovered-claim set', () => {
    // The shape that killed the pipeline: ~79 discovered claims across the usual attributes.
    const claims: ClaimRecord[] = [];
    for (let i = 0; i < 40; i += 1) {
      claims.push(discovered('discovered.sameAs', `https://github.com/user${i}`));
      claims.push(discovered('discovered.description', `A distinct biography number ${i} about the subject.`));
      claims.push(discovered('discovered.email', `person${i}@example.org`));
    }
    const conflicts = detectConflicts({ claims, sourceMeta: {} });
    // The old behaviour produced thousands here. It must now produce none.
    expect(conflicts.length).toBe(0);
  });

  it('stays fast at that size', () => {
    const claims: ClaimRecord[] = [];
    for (let i = 0; i < 60; i += 1) {
      claims.push(discovered('discovered.sameAs', `https://github.com/user${i}`));
    }
    const started = Date.now();
    detectConflicts({ claims, sourceMeta: {} });
    expect(Date.now() - started).toBeLessThan(2000);
  });
});

describe('conflict detection: genuine contradictions are still detected', () => {
  it('still flags two clearly different current values of a single-valued attribute', () => {
    // Note: two *similar* names are deliberately not a value contradiction — §10 requires that
    // similar names alone never connect or separate identities. Only clearly different values
    // of a single-valued attribute are contradictions.
    const conflicts = detectConflicts({
      claims: [
        claim({ attribute_key: 'identity.primaryName', value_text: 'Ada Lovelace', is_current: true }),
        claim({ attribute_key: 'identity.primaryName', value_text: 'Grace Hopper', is_current: true }),
      ],
      sourceMeta: {},
    });
    expect(conflicts.length).toBeGreaterThan(0);
  });

  it('does not treat two similar names as a contradiction', () => {
    const conflicts = detectConflicts({
      claims: [
        claim({ attribute_key: 'identity.primaryName', value_text: 'Linus Torvalds', is_current: true }),
        claim({ attribute_key: 'identity.primaryName', value_text: 'Linus Benedict Torvalds', is_current: true }),
      ],
      sourceMeta: {},
    });
    expect(conflicts).toEqual([]);
  });

  it('still flags two different current locations', () => {
    const conflicts = detectConflicts({
      claims: [
        claim({ attribute_key: 'identity.location', value_text: 'Portland, USA', is_current: true }),
        claim({ attribute_key: 'identity.location', value_text: 'Helsinki, Finland', is_current: true }),
      ],
      sourceMeta: {},
    });
    expect(conflicts.length).toBeGreaterThan(0);
  });
});
