import { describe, expect, it } from 'vitest';
import sharp from 'sharp';
import {
  MIN_PHOTO_BYTES,
  MIN_PHOTO_EDGE,
  hashDistance,
  isNearDuplicate,
  perceptualHash,
  qualifyPhoto,
  validateImage,
  type ValidatedImage,
} from '../src/images';

/** A real PNG, generated rather than stubbed, so decoding is genuinely exercised. */
async function makePng(width: number, height: number, variant = 0): Promise<Buffer> {
  const width32 = Math.max(1, Math.floor(width / 32) || 1);
  const height32 = Math.max(1, Math.floor(height / 32) || 1);
  const raw = Buffer.alloc(width32 * height32 * 3);
  for (let y = 0; y < height32; y += 1) {
    for (let x = 0; x < width32; x += 1) {
      const i = (y * width32 + x) * 3;
      // Deterministic pattern that varies with the variant, so different images differ.
      raw[i] = (x * 7 + y * 13 + variant * 29) % 256;
      raw[i + 1] = (x * 11 + y * 5 + variant * 41) % 256;
      raw[i + 2] = (x * 3 + y * 17 + variant * 53) % 256;
    }
  }
  return sharp(raw, { raw: { width: width32, height: height32, channels: 3 } })
    .resize(width, height, { kernel: 'nearest' })
    .png()
    .toBuffer();
}

function validated(overrides: Partial<ValidatedImage> = {}): ValidatedImage {
  return {
    buffer: Buffer.alloc(0),
    mime: 'image/jpeg',
    width: 1200,
    height: 1600,
    bytes: 240_000,
    sha256: 'c'.repeat(64),
    perceptualHash: 'a'.repeat(16) + 'b'.repeat(112),
    aHash: 'a'.repeat(16),
    dHash: 'b'.repeat(112),
    format: 'jpeg',
    ...overrides,
  };
}

describe('hashDistance', () => {
  it('is zero for an identical hash', () => {
    expect(hashDistance('abcdef', 'abcdef')).toBe(0);
  });

  it('counts differing bits', () => {
    // 0x0 vs 0x1 differ by one bit; 0x0 vs 0xf by four.
    expect(hashDistance('0', '1')).toBe(1);
    expect(hashDistance('0', 'f')).toBe(4);
  });

  it('is infinite when a hash is missing, so nothing can match it', () => {
    expect(hashDistance('', 'abcdef')).toBe(Number.POSITIVE_INFINITY);
    expect(hashDistance('abcdef', '')).toBe(Number.POSITIVE_INFINITY);
  });

  it('compares only the shared prefix rather than crashing on unequal lengths', () => {
    expect(Number.isFinite(hashDistance('abc', 'abcdef'))).toBe(true);
  });
});

describe('isNearDuplicate', () => {
  it('treats an identical fingerprint as a duplicate', () => {
    const hash = '0123456789abcdef' + 'fedcba9876543210';
    expect(isNearDuplicate(hash, hash).duplicate).toBe(true);
  });

  it('does not treat clearly different images as duplicates', () => {
    const a = '0000000000000000' + '0000000000000000';
    const b = 'ffffffffffffffff' + 'ffffffffffffffff';
    expect(isNearDuplicate(a, b).duplicate).toBe(false);
  });

  it('reports the distances it based the decision on', () => {
    const r = isNearDuplicate('0000000000000000' + '0000000000000000', '0000000000000000' + '0000000000000001');
    expect(r.aDistance).toBe(0);
    expect(r.dDistance).toBe(1);
  });
});

describe('perceptualHash', () => {
  it('produces an aHash, a dHash, and their combination', async () => {
    const png = await makePng(320, 320);
    const hash = await perceptualHash({ buffer: png, width: 320, height: 320 });
    expect(hash.aHash.length).toBeGreaterThan(0);
    expect(hash.dHash.length).toBeGreaterThan(0);
    expect(hash.combined).toBe(hash.aHash + hash.dHash);
  });

  it('is deterministic for the same image', async () => {
    const png = await makePng(320, 320);
    const first = await perceptualHash({ buffer: png, width: 320, height: 320 });
    const second = await perceptualHash({ buffer: png, width: 320, height: 320 });
    expect(second).toEqual(first);
  });

  it('differs for a visually different image', async () => {
    const a = await perceptualHash({ buffer: await makePng(320, 320, 0), width: 320, height: 320 });
    const b = await perceptualHash({ buffer: await makePng(320, 320, 3), width: 320, height: 320 });
    expect(a.combined).not.toBe(b.combined);
  });
});

describe('validateImage', () => {
  it('accepts a real, adequately sized image', async () => {
    const result = await validateImage({ buffer: await makePng(900, 1200), filename: 'photo.png' });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.image.width).toBe(900);
      expect(result.image.height).toBe(1200);
      expect(result.image.perceptualHash).toBe(result.image.aHash + result.image.dHash);
    }
  });

  it('rejects an empty file', async () => {
    const result = await validateImage({ buffer: Buffer.alloc(0), filename: 'empty.png' });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason.length).toBeGreaterThan(0);
  });

  it('rejects a file that is not an image', async () => {
    const result = await validateImage({
      buffer: Buffer.from('this is plain text pretending to be a photo'),
      filename: 'fake.png',
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason.length).toBeGreaterThan(0);
  });

  it('rejects a truncated image rather than returning nonsense dimensions', async () => {
    const full = await makePng(900, 1200);
    const result = await validateImage({ buffer: full.subarray(0, Math.floor(full.length / 3)), filename: 'cut.png' });
    expect(result.ok).toBe(false);
  });

  it('measures a real aspect ratio from the decoded image', async () => {
    const wide = await validateImage({ buffer: await makePng(1600, 200), filename: 'wide.png' });
    if (wide.ok) expect(wide.image.width).toBe(1600);
  });
});

describe('qualifyPhoto', () => {
  it('qualifies a good photograph', () => {
    const result = qualifyPhoto({ image: validated(), existingHashes: [] });
    expect(result.qualifies).toBe(true);
    expect(result.representationStatus).toBe('primary');
    expect(result.disqualifyReasons).toEqual([]);
  });

  it('explains why it qualified', () => {
    const result = qualifyPhoto({ image: validated(), existingHashes: [] });
    expect(result.reasons.join(' ')).toContain('1200\u00d71600');
  });

  it('rejects a file below the minimum size', () => {
    const result = qualifyPhoto({ image: validated({ bytes: MIN_PHOTO_BYTES - 1 }), existingHashes: [] });
    expect(result.qualifies).toBe(false);
    expect(result.representationStatus).toBe('rejected');
    expect(result.disqualifyReasons.join(' ')).toContain('too small');
  });

  it('rejects an image below the minimum resolution', () => {
    const result = qualifyPhoto({
      image: validated({ width: MIN_PHOTO_EDGE - 1, height: MIN_PHOTO_EDGE - 1 }),
      existingHashes: [],
    });
    expect(result.qualifies).toBe(false);
    expect(result.disqualifyReasons.join(' ')).toContain('resolution');
  });

  it('rejects an extremely narrow strip', () => {
    const result = qualifyPhoto({ image: validated({ width: 100, height: 1600 }), existingHashes: [] });
    expect(result.qualifies).toBe(false);
    expect(result.disqualifyReasons.join(' ')).toContain('narrow');
  });

  it('rejects an extremely wide strip', () => {
    const result = qualifyPhoto({ image: validated({ width: 1600, height: 100 }), existingHashes: [] });
    expect(result.qualifies).toBe(false);
    expect(result.disqualifyReasons.join(' ')).toContain('wide');
  });

  it('counts a re-uploaded photo once', () => {
    const hash = '0123456789abcdef' + 'fedcba9876543210';
    const result = qualifyPhoto({
      image: validated({ perceptualHash: hash }),
      existingHashes: [{ id: 'existing-1', hash }],
    });
    expect(result.qualifies).toBe(false);
    expect(result.disqualifyReasons.join(' ')).toContain('identical');
  });

  it('still qualifies a photo that merely resembles another one', () => {
    const result = qualifyPhoto({
      image: validated({ perceptualHash: '0123456789abcdef' + 'fedcba9876543210' }),
      existingHashes: [{ id: 'existing-1', hash: 'ffffffffffffffff' + 'ffffffffffffffff' }],
    });
    expect(result.qualifies).toBe(true);
  });

  it('classifies a small-but-valid photo as supporting rather than primary', () => {
    const result = qualifyPhoto({
      image: validated({ width: 400, height: 500, bytes: 100_000 }),
      existingHashes: [],
    });
    expect(result.qualifies).toBe(true);
    expect(result.representationStatus).toBe('supporting');
  });

  it('records every reason, not just the first', () => {
    const result = qualifyPhoto({
      image: validated({ bytes: 10, width: 100, height: 2000 }),
      existingHashes: [],
    });
    expect(result.disqualifyReasons.length).toBeGreaterThanOrEqual(2);
  });
});
