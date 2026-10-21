/**
 * Verifies that the in-memory double mirrors the real `@nexora/db` public surface.
 *
 * A missing export means application code would resolve it against PostgreSQL in tests and against
 * memory in development — or fail to bundle in one of the two. Catching it here is far cheaper
 * than discovering it as an unexplained 500 during a browser run.
 */

import { describe, expect, it } from 'vitest';

import * as real from '../src/index';
import * as memory from '../src/memory-index';

type Mod = Record<string, unknown>;

const runtimeNames = (m: Mod): string[] => Object.keys(m).filter((k) => k !== 'default');

describe('in-memory database double', () => {
  const realNames = runtimeNames(real as Mod).sort();
  const memoryNames = runtimeNames(memory as Mod);

  it('exports every runtime function the real package exports', () => {
    const missing = realNames.filter((n) => !memoryNames.includes(n));
    expect(missing).toEqual([]);
  });

  it('does not shadow a real export with a different kind', () => {
    const wrongKind = realNames.filter(
      (n) => typeof (real as Mod)[n] === 'function' && typeof (memory as Mod)[n] !== 'function',
    );
    expect(wrongKind).toEqual([]);
  });

  it('refuses every store access in production, even when already imported', async () => {
    // Import first so the module graph is cached, then flip to production. A load-time-only guard
    // would pass here and let a cached double keep serving rows in a production process.
    const { mem } = await import('../src/memory-store');
    expect(mem.sizes()).toBeTypeOf('object');

    const previous = process.env.NODE_ENV;
    (process.env as Record<string, string | undefined>).NODE_ENV = 'production';
    try {
      expect(() => mem.table('users')).toThrow(/refuses to run with NODE_ENV=production/);
      expect(() => mem.sizes()).toThrow(/refuses to run with NODE_ENV=production/);
    } finally {
      (process.env as Record<string, string | undefined>).NODE_ENV = previous;
    }
    expect(() => mem.sizes()).not.toThrow();
  });
});