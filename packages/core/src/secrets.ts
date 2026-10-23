/**
 * Secret material at rest.
 *
 * A provider key the person supplies has to be *used* by the platform, not merely checked, so it
 * cannot be hashed the way a session token is: it has to be recoverable. It is therefore encrypted
 * with AES-256-GCM under a key derived from the account's secret, so the stored value is useless
 * to anyone who reads the database without also holding the account's secret.
 *
 * The encrypted form is safe to keep beside other configuration and is never returned by an
 * endpoint, written to a log, or sent to the browser.
 */

import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { config } from './config';

const VERSION = 'v1';

function keyMaterial(): Buffer {
  // Deriving from the account secret means the key is unique to this deployment, and rotating the
  // secret makes every stored credential unreadable rather than silently stale.
  return createHash('sha256').update(`${config().secretKey}:${VERSION}:provider-credentials`).digest();
}

/**
 * Encrypt a secret for storage.
 *
 * A fresh nonce is generated for every value, so encrypting the same secret twice never produces
 * the same ciphertext.
 */
export function encryptSecret(plaintext: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', keyMaterial(), iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [VERSION, iv.toString('base64'), tag.toString('base64'), encrypted.toString('base64')].join('.');
}

/**
 * Decrypt a stored secret.
 *
 * Returns null when the value is missing, malformed, or was encrypted under a different secret.
 * A credential that cannot be read is treated as absent rather than as a hard failure, so a rotated
 * secret degrades to "this provider needs its key again" instead of breaking the whole screen.
 */
export function decryptSecret(stored: string | null | undefined): string | null {
  if (!stored) return null;
  const parts = stored.split('.');
  if (parts.length !== 4 || parts[0] !== VERSION) return null;
  try {
    const iv = Buffer.from(parts[1]!, 'base64');
    const tag = Buffer.from(parts[2]!, 'base64');
    const encrypted = Buffer.from(parts[3]!, 'base64');
    const decipher = createDecipheriv('aes-256-gcm', keyMaterial(), iv);
    decipher.setAuthTag(tag);
    const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()]);
    return decrypted.toString('utf8');
  } catch {
    return null;
  }
}

/** Whether a stored value looks like an encrypted secret, so a plaintext key is never stored. */
export function isEncryptedSecret(value: string | null | undefined): boolean {
  return typeof value === 'string' && value.startsWith(`${VERSION}.`) && value.split('.').length === 4;
}
