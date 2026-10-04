import { describe, expect, it } from 'vitest';
import {
  AuthError,
  ConfigurationError,
  ErrorDomain,
  isNexoraError,
  ReadinessBlockedError,
  StorageError,
  SystemError,
  toActionableError,
} from '../src/errors';

describe('toActionableError', () => {
  it('passes an already-actionable error through unchanged', () => {
    const original = SystemError('Something is briefly unavailable.');
    const converted = toActionableError(original);
    expect(converted.code).toBe(original.code);
    expect(converted.message).toBe(original.message);
  });

  it('turns an unknown throw into a system error rather than leaking the raw message', () => {
    const converted = toActionableError(new Error('postgres://user:hunter2@host/db exploded'));
    expect(converted.domain).toBe('system');
    expect(converted.message).not.toContain('hunter2');
  });

  it('always supplies a remediation the interface can act on', () => {
    const converted = toActionableError(new Error('boom'));
    expect(Array.isArray(converted.remediation)).toBe(true);
    expect(converted.remediation.length).toBeGreaterThan(0);
  });

  it('always reports whether the user’s progress is preserved', () => {
    expect(typeof toActionableError(new Error('a')).preservesUserProgress).toBe('boolean');
    expect(typeof toActionableError(new Error('b')).preservesUserProgress).toBe('boolean');
  });

  it('always carries a timestamp and an HTTP status', () => {
    const converted = toActionableError(new Error('a'));
    expect(Number.isNaN(Date.parse(converted.occurredAt))).toBe(false);
    expect(converted.status).toBeGreaterThanOrEqual(400);
  });

  it('handles a non-Error throw without crashing', () => {
    const converted = toActionableError('just a string');
    expect(converted.domain).toBe(ErrorDomain.system);
    expect(converted.message.length).toBeGreaterThan(0);
  });
});

describe('error taxonomy', () => {
  it('recognises its own error type', () => {
    expect(isNexoraError(SystemError('x'))).toBe(true);
    expect(isNexoraError(new Error('x'))).toBe(false);
  });

  it('classifies a blocked readiness gate as blocking, not retryable', () => {
    const err = ReadinessBlockedError('Your entity is not ready to publish yet.');
    expect(err.domain).toBe('readiness');
    expect(err.retryable).toBe(false);
  });

  it('treats a missing configuration as a configuration-domain error', () => {
    expect(ConfigurationError('OpenCode is not installed.').domain).toBe('configuration');
  });

  it('treats a storage failure as retryable, because the write can be repeated', () => {
    expect(StorageError('The upload could not be saved.').retryable).toBe(true);
  });

  it('marks a credential rejection retryable, since corrected details can succeed', () => {
    const err = AuthError.invalidCredentials();
    expect(err.domain).toBe('auth');
    expect(err.retryable).toBe(true);
    expect(err.remediation.some((r) => r.kind === 'retry')).toBe(true);
  });

  it('does not invite a retry when the account is locked', () => {
    const err = AuthError.accountLocked();
    expect(err.remediation.every((r) => r.kind !== 'retry')).toBe(true);
  });
});

describe('credential redaction', () => {
  it('never exposes a secret through an error detail', () => {
    const err = toActionableError(new Error('failed for api_key=sk-live-ABCDEFGHIJ'));
    expect(JSON.stringify(err)).not.toContain('sk-live-ABCDEFGHIJ');
  });

  it('never exposes a bearer token', () => {
    const err = toActionableError(new Error('Authorization: Bearer abcdef0123456789 rejected'));
    expect(JSON.stringify(err)).not.toContain('abcdef0123456789');
  });
});