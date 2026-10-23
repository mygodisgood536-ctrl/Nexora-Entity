import { describe, expect, it } from 'vitest';
import { decryptSecret, encryptSecret, isEncryptedSecret } from '../src/secrets';

describe('provider credentials at rest', () => {
  it('returns the original value when decrypted', () => {
    const secret = 'sk-provider-abc123';
    expect(decryptSecret(encryptSecret(secret))).toBe(secret);
  });

  it('never stores the secret in the clear', () => {
    const secret = 'sk-provider-abc123';
    const stored = encryptSecret(secret);
    expect(stored).not.toContain(secret);
    expect(stored.startsWith('v1.')).toBe(true);
  });

  it('produces a different ciphertext each time for the same secret', () => {
    // A repeated ciphertext would let someone tell that two accounts hold the same key.
    const a = encryptSecret('same-key');
    const b = encryptSecret('same-key');
    expect(a).not.toBe(b);
    expect(decryptSecret(a)).toBe(decryptSecret(b));
  });

  it('treats a missing value as absent rather than failing', () => {
    expect(decryptSecret(null)).toBeNull();
    expect(decryptSecret(undefined)).toBeNull();
    expect(decryptSecret('')).toBeNull();
  });

  it('treats a malformed value as absent rather than failing', () => {
    expect(decryptSecret('not-a-cipher')).toBeNull();
    expect(decryptSecret('v1.aaa')).toBeNull();
  });

  it('refuses a value whose tag does not match', () => {
    const stored = encryptSecret('sk-provider-abc123');
    const parts = stored.split('.');
    // A tampered ciphertext must not decrypt to anything.
    const tampered = [parts[0], parts[1], 'AAAAAAAAAAAAAAAAAAAAAA==', parts[3]].join('.');
    expect(decryptSecret(tampered)).toBeNull();
  });

  it('recognises an encrypted value', () => {
    expect(isEncryptedSecret(encryptSecret('x'))).toBe(true);
    expect(isEncryptedSecret('sk-plaintext')).toBe(false);
    expect(isEncryptedSecret(null)).toBe(false);
  });
});
