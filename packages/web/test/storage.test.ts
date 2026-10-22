/**
 * Storage abstraction tests.
 *
 * Section 30 requires uploaded photos to be protected, and section 33 asks for secure file and
 * photo storage. These tests pin the behaviour that matters: an upload is written under a name
 * the caller does not control, a key cannot escape the storage root, and the bytes that come
 * back are the bytes that went in.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { contentDigest, isAllowedImageType, resetStorage, storage, storageKeyFor } from '../src/lib/storage';

describe('storage keys', () => {
  it('never uses the original file name in the key', () => {
    const key = storageKeyFor('photos', 'My Passport Photo (final).jpg', 'image/jpeg');
    expect(key).toMatch(/^photos\//);
    expect(key).not.toContain('Passport');
    expect(key.endsWith('.jpg')).toBe(true);
  });

  it('gives two uploads of the same name different keys', () => {
    const a = storageKeyFor('photos', 'photo.jpg', 'image/jpeg');
    const b = storageKeyFor('photos', 'photo.jpg', 'image/jpeg');
    expect(a).not.toBe(b);
  });

  it('keeps a safe extension and rejects an unusual one', () => {
    expect(storageKeyFor('photos', 'a.png', 'image/png').endsWith('.png')).toBe(true);
    expect(storageKeyFor('photos', 'a.exe', 'application/octet-stream')).not.toContain('.exe');
  });
});

describe('image types', () => {
  it('accepts the formats the product supports', () => {
    expect(isAllowedImageType('image/jpeg')).toBe(true);
    expect(isAllowedImageType('image/png')).toBe(true);
    expect(isAllowedImageType('image/webp')).toBe(true);
  });

  it('rejects anything that is not an image', () => {
    expect(isAllowedImageType('application/pdf')).toBe(false);
    expect(isAllowedImageType('text/html')).toBe(false);
  });
});

describe('content digest', () => {
  it('is stable for the same bytes and different for different bytes', () => {
    const a = contentDigest(Buffer.from('hello'));
    const b = contentDigest(Buffer.from('hello'));
    const c = contentDigest(Buffer.from('hello!'));
    expect(a).toBe(b);
    expect(a).not.toBe(c);
  });
});

describe('the local driver', () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(path.join(tmpdir(), 'nexora-storage-'));
    process.env.NEXORA_STORAGE_DIR = root;
    process.env.NEXORA_ALLOW_LOCAL_STORAGE = '1';
    resetStorage();
  });

  afterEach(async () => {
    resetStorage();
    delete process.env.NEXORA_STORAGE_DIR;
    delete process.env.NEXORA_ALLOW_LOCAL_STORAGE;
    await rm(root, { recursive: true, force: true });
  });

  it('stores an object and returns exactly the bytes that went in', async () => {
    const body = Buffer.from([1, 2, 3, 4, 5]);
    const stored = await storage().put('photos/test.jpg', body, 'image/jpeg');
    expect(stored.size).toBe(body.length);

    const read = await storage().get('photos/test.jpg');
    expect(read).not.toBeNull();
    expect(read?.body.equals(body)).toBe(true);
    expect(read?.contentType).toBe('image/jpeg');
  });

  it('returns null for an object that was never stored', async () => {
    expect(await storage().get('photos/missing.jpg')).toBeNull();
  });

  it('refuses a key that tries to escape the storage root', async () => {
    await expect(storage().get('../escape.jpg')).rejects.toThrow(/outside the storage root/);
  });

  it('deletes an object', async () => {
    await storage().put('photos/gone.jpg', Buffer.from('x'), 'image/jpeg');
    await storage().delete('photos/gone.jpg');
    expect(await storage().get('photos/gone.jpg')).toBeNull();
  });

  it('addresses an object by a URL under /media', () => {
    expect(storage().publicUrl('photos/a.jpg')).toBe('/media/photos/a.jpg');
  });
});
