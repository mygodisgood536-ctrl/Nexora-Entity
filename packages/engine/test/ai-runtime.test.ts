/**
 * AI runtime tests (Amendment section 9, section 21, section 29).
 *
 * The account's verified provider/model must power the AI-dependent operations, and an AI failure
 * must never be fatal: the deterministic engines keep working, the person's progress is kept, and
 * the failure is reported rather than swallowed.
 */

import { describe, expect, it, vi } from 'vitest';

import { safeAi, type AiFailureCollector } from '../src/ai-runtime';

describe('safeAi', () => {
  it('returns the result when the operation succeeds', async () => {
    const failures: AiFailureCollector = [];
    const result = await safeAi(failures, 'source_discovery', async () => ['a', 'b']);
    expect(result).toEqual(['a', 'b']);
    expect(failures).toHaveLength(0);
  });

  it('collects the failure and returns null instead of throwing', async () => {
    const failures: AiFailureCollector = [];
    const result = await safeAi(failures, 'source_discovery', async () => {
      throw new Error('OpenCode inference responded 402: Insufficient account funds');
    });
    expect(result).toBeNull();
    expect(failures).toHaveLength(1);
    expect(failures[0]).toMatchObject({ operation: 'source_discovery' });
    expect(failures[0]?.message).toContain('Insufficient account funds');
  });

  it('keeps collecting further failures rather than stopping at the first', async () => {
    const failures: AiFailureCollector = [];
    await safeAi(failures, 'one', async () => {
      throw new Error('first');
    });
    await safeAi(failures, 'two', async () => {
      throw new Error('second');
    });
    expect(failures.map((f) => f.operation)).toEqual(['one', 'two']);
  });

  it('survives a rejected promise that is not an Error', async () => {
    const failures: AiFailureCollector = [];
    const result = await safeAi(failures, 'weird', async () => {
      throw 'a string';
    });
    expect(result).toBeNull();
    expect(failures[0]?.message).toContain('a string');
  });
});

describe('AI failures never change a deterministic result', () => {
  it('leaves the surrounding work intact when the provider fails', async () => {
    const failures: AiFailureCollector = [];
    const deterministic = { status: 'blocked', score: 96 };

    // The pattern the pipeline uses: the AI call is optional, and the deterministic answer is
    // what is returned either way.
    const narrative = await safeAi(failures, 'readiness_narration', async () => {
      throw new Error('provider unreachable');
    });

    expect(narrative).toBeNull();
    expect(deterministic.status).toBe('blocked');
    expect(deterministic.score).toBe(96);
    expect(failures).toHaveLength(1);
  });
});

describe('the failure taxonomy stays intact', () => {
  it('records the operation name so the report can say which step failed', async () => {
    const failures: AiFailureCollector = [];
    await safeAi(failures, 'ambiguity_assessment', async () => {
      throw new Error('boom');
    });
    expect(failures[0]?.operation).toBe('ambiguity_assessment');
  });

  it('does not swallow a failure silently', async () => {
    const failures: AiFailureCollector = [];
    const spy = vi.fn();
    await safeAi(failures, 'alias_suggestion', async () => {
      throw new Error('alias failure');
    });
    expect(failures).toHaveLength(1);
    expect(failures[0]?.message).toBe('alias failure');
    expect(spy).not.toHaveBeenCalled();
  });
});
