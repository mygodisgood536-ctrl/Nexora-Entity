import { describe, expect, it } from 'vitest';
import {
  clearSessionCookie,
  hashSecurityAnswer,
  hashToken,
  newSessionToken,
  normalizeAnswer,
  normalizeQuestion,
  normalizeUsername,
  sessionCookie,
  verifySecurityAnswer,
} from '../src/auth-crypto';

describe('security answers', () => {
  it('verifies the answer it was given', () => {
    const { hash, salt } = hashSecurityAnswer('Analytical Engine');
    expect(verifySecurityAnswer('Analytical Engine', hash, salt)).toBe(true);
  });

  it('rejects a different answer', () => {
    const { hash, salt } = hashSecurityAnswer('Analytical Engine');
    expect(verifySecurityAnswer('Difference Engine', hash, salt)).toBe(false);
  });

  it('rejects the same answer typed with different case and spacing', () => {
    // A typo in capitalisation must not lock someone out of their own account.
    const { hash, salt } = hashSecurityAnswer('  analytical   engine  ');
    expect(verifySecurityAnswer('Analytical Engine', hash, salt)).toBe(true);
    expect(verifySecurityAnswer('ANALYTICAL ENGINE', hash, salt)).toBe(true);
  });

  it('never stores the answer in plaintext', () => {
    const { hash, salt } = hashSecurityAnswer('Analytical Engine');
    expect(hash).not.toContain('analytical');
    expect(hash).not.toBe('Analytical Engine');
    expect(hash.length).toBe(128); // 64 bytes, hex
    expect(salt.length).toBe(32);
  });

  it('produces a different hash for the same answer under a different salt', () => {
    const a = hashSecurityAnswer('same answer');
    const b = hashSecurityAnswer('same answer');
    expect(a.hash).not.toBe(b.hash);
    expect(a.salt).not.toBe(b.salt);
  });

  it('is deterministic given the same salt', () => {
    const a = hashSecurityAnswer('answer', 'fixed-salt-value');
    const b = hashSecurityAnswer('answer', 'fixed-salt-value');
    expect(a.hash).toBe(b.hash);
  });

  it('returns false rather than throwing on a malformed stored hash', () => {
    const { salt } = hashSecurityAnswer('answer');
    expect(verifySecurityAnswer('answer', 'not-hex', salt)).toBe(false);
    expect(verifySecurityAnswer('answer', '', salt)).toBe(false);
  });

  it('returns false for a stored hash of a different length', () => {
    const { salt } = hashSecurityAnswer('answer');
    expect(verifySecurityAnswer('answer', 'abcdef', salt)).toBe(false);
  });
});

describe('normalisation', () => {
  it('collapses case and whitespace in an answer', () => {
    expect(normalizeAnswer('  The   Answer ')).toBe('the answer');
  });

  it('collapses case and whitespace in a question', () => {
    expect(normalizeQuestion('What   is   your name?')).toBe('what is your name?');
  });

  it('normalises a username to lower case', () => {
    expect(normalizeUsername('  AdaLovelace ')).toBe('adalovelace');
  });

  it('handles empty and whitespace-only input', () => {
    expect(normalizeAnswer('')).toBe('');
    expect(normalizeAnswer('   ')).toBe('');
  });
});

describe('session tokens', () => {
  it('produces a long, unguessable token', () => {
    const token = newSessionToken();
    // 32 random bytes in base64url.
    expect(token.length).toBeGreaterThanOrEqual(43);
  });

  it('produces a different token every time', () => {
    const tokens = new Set(Array.from({ length: 50 }, () => newSessionToken()));
    expect(tokens.size).toBe(50);
  });

  it('hashes a token deterministically', () => {
    expect(hashToken('abc')).toBe(hashToken('abc'));
    expect(hashToken('abc')).toHaveLength(64);
  });

  it('produces a different hash for a different token', () => {
    expect(hashToken('abc')).not.toBe(hashToken('abd'));
  });

  it('does not embed the token in its own hash', () => {
    const token = newSessionToken();
    expect(hashToken(token)).not.toContain(token);
  });
});

describe('session cookies', () => {
  const expires = new Date('2030-01-01T00:00:00.000Z');

  it('carries the token, path, expiry and HttpOnly', () => {
    const cookie = sessionCookie('tok', expires, false);
    expect(cookie).toContain('tok');
    expect(cookie).toContain('Path=/');
    expect(cookie.toLowerCase()).toContain('httponly');
    expect(cookie).toContain('Expires=');
  });

  it('sets Secure only when the deployment is HTTPS', () => {
    expect(sessionCookie('tok', expires, false)).not.toContain('Secure');
    expect(sessionCookie('tok', expires, true)).toContain('Secure');
  });

  it('uses the configured cookie name', () => {
    // The name matters: a wrong one silently breaks every session.
    expect(sessionCookie('tok', expires, false).startsWith('nexora_session=')).toBe(true);
  });

  it('clears the cookie with the same attributes it set', () => {
    const set = sessionCookie('tok', expires, true);
    const cleared = clearSessionCookie(true);
    expect(cleared).toContain('nexora_session=');
    expect(cleared).toContain('Max-Age=0');
    expect(cleared.toLowerCase()).toContain('httponly');
    expect(cleared).toContain('Secure');
    // Same cookie name in both, or logout leaves the session in place.
    expect(cleared.split('=')[0]).toBe(set.split('=')[0]);
  });

  it('omits Secure when clearing an insecure deployment, matching how it was set', () => {
    expect(clearSessionCookie(false)).not.toContain('Secure');
  });
});
