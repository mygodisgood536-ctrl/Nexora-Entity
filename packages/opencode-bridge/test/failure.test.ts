/**
 * Failure-classification tests (spec §6).
 *
 * A provider failure must never be reported to the person as a problem with their entity data,
 * and the classification drives whether the UI offers a retry, a model change, or credential
 * help. These are the rules the guided flow relies on to keep a person's progress safe when a
 * provider is rate-limited, out of quota, timing out or returning an unreadable response.
 */

import { describe, expect, it } from 'vitest';

import { classifyProviderFailure, failureCode, ProviderFailureKind } from '../src/failure';

describe('classifyProviderFailure', () => {
  const cases: { input: string; kind: ProviderFailureKind }[] = [
    { input: 'rate limit exceeded, slow down', kind: ProviderFailureKind.rateLimited },
    { input: 'HTTP 429 Too Many Requests', kind: ProviderFailureKind.rateLimited },
    { input: 'insufficient_quota: you exceeded your current quota', kind: ProviderFailureKind.usageLimit },
    { input: 'payment required', kind: ProviderFailureKind.usageLimit },
    // The hosted bridge reports a depleted workspace allowance as a 402 with this wording.
    { input: 'OpenCode inference responded 402: Insufficient account funds', kind: ProviderFailureKind.usageLimit },
    { input: 'HTTP 402 Payment Required', kind: ProviderFailureKind.usageLimit },
    // The hosted bridge refuses its free models when they are called from outside OpenCode. That
    // is not a credential problem, so it must not be reported as one.
    {
      input: 'OpenCode inference responded 403: FreeTierError: free tier can only be used from within OpenCode',
      kind: ProviderFailureKind.modelUnavailable,
    },
    { input: '401 Unauthorized', kind: ProviderFailureKind.authenticationFailed },
    { input: 'invalid api key supplied', kind: ProviderFailureKind.authenticationFailed },
    { input: 'model not found: gpt-foo', kind: ProviderFailureKind.modelUnavailable },
    { input: 'unknown provider: acme', kind: ProviderFailureKind.modelUnavailable },
    { input: 'request timed out after 30s', kind: ProviderFailureKind.timeout },
    { input: 'connect ECONNREFUSED 127.0.0.1:11434', kind: ProviderFailureKind.networkFailure },
    { input: 'fetch failed', kind: ProviderFailureKind.networkFailure },
    { input: '503 Service Unavailable', kind: ProviderFailureKind.temporarilyUnavailable },
    { input: 'model overloaded, try again later', kind: ProviderFailureKind.temporarilyUnavailable },
    { input: 'blocked by content policy', kind: ProviderFailureKind.contentFiltered },
    { input: 'maximum context length exceeded', kind: ProviderFailureKind.contextOverflow },
    { input: 'unexpected token < in JSON at position 0', kind: ProviderFailureKind.invalidResponse },
    { input: 'HTTP 500 internal server error', kind: ProviderFailureKind.serverError },
    { input: 'I refuse to assist with that', kind: ProviderFailureKind.refused },
    { input: 'something entirely unclassified happened', kind: ProviderFailureKind.unknown },
  ];

  for (const { input, kind } of cases) {
    it(`classifies ${JSON.stringify(input.slice(0, 32))} as ${kind}`, () => {
      expect(classifyProviderFailure(input).kind).toBe(kind);
    });
  }

  it('reads an Error message and its cause, not just a bare string', () => {
    const err = new Error('outer problem', { cause: new Error('insufficient_quota') });
    expect(classifyProviderFailure(err).kind).toBe(ProviderFailureKind.usageLimit);
  });

  it('never returns the raw provider text as the message shown to the person', () => {
    const raw = 'HTTP 429 rate limit exceeded for key sk-secret-123';
    const result = classifyProviderFailure(raw);
    expect(result.raw).toContain('429');
    expect(result.userMessage).not.toBe(raw);
    expect(result.userMessage).not.toContain('429');
    expect(result.userMessage.toLowerCase()).not.toContain('key');
  });

  it('marks quota and auth failures as requiring a change, rate limits as retryable', () => {
    expect(classifyProviderFailure('insufficient_quota')).toMatchObject({
      retryable: false,
      requiresModelChange: true,
      requiresCredentials: true,
    });
    expect(classifyProviderFailure('401 unauthorized')).toMatchObject({
      retryable: false,
      requiresCredentials: true,
    });
    expect(classifyProviderFailure('rate limit')).toMatchObject({ retryable: true, requiresModelChange: false });
  });

  it('survives a non-Error, non-string value without throwing', () => {
    expect(classifyProviderFailure({ weird: true }).kind).toBe(ProviderFailureKind.unknown);
    expect(classifyProviderFailure(null).kind).toBe(ProviderFailureKind.unknown);
    expect(classifyProviderFailure(undefined).kind).toBe(ProviderFailureKind.unknown);
  });

  it('namespaces the stored error code by kind', () => {
    expect(failureCode(ProviderFailureKind.rateLimited)).toBe('ai_provider_rate_limited');
    expect(failureCode(ProviderFailureKind.unknown)).toBe('ai_provider_unknown');
  });

  it('keeps the original classification when an already-classified failure is classified again', () => {
    // The bridge classifies a failure where the provider's own words are still available, then
    // throws it as a plain-language error. Re-classifying that error must not lose the cause.
    const carried = Object.assign(new Error('This AI provider has run out of the allowance attached to it.'), {
      context: {
        failureKind: ProviderFailureKind.usageLimit,
        retryable: false,
        requiresModelChange: true,
        requiresCredentials: true,
        raw: 'OpenCode inference responded 402: Insufficient account funds',
      },
    });
    const again = classifyProviderFailure(carried);
    expect(again.kind).toBe(ProviderFailureKind.usageLimit);
    expect(again.retryable).toBe(false);
    expect(again.requiresModelChange).toBe(true);
    expect(again.requiresCredentials).toBe(true);
    expect(again.raw).toContain('Insufficient account funds');
  });

  it('does not trust a context that does not name a known failure kind', () => {
    const spoofed = Object.assign(new Error('something broke'), {
      context: { failureKind: 'not_a_real_kind' },
    });
    expect(classifyProviderFailure(spoofed).kind).toBe(ProviderFailureKind.unknown);
  });
});
