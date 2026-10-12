/**
 * Real image validation.
 *
 * Photos are only counted toward the internal 4-photo minimum when they are genuinely valid,
 * sufficiently large, and not duplicates of each other. Uses sharp for real decoding plus a
 * perceptual hash so near-identical re-uploads are rejected honestly.
 */

import { createHash } from 'node:crypto';
import sharp from 'sharp';

export interface ValidatedImage {
  buffer: Buffer;
  mime: string;
  width: number;
  height: number;
  bytes: number;
  sha256: string;
  /** Combined aHash+dHash, persisted for duplicate detection. */
  perceptualHash: string;
  aHash: string;
  dHash: string;
  format: string;
}

export interface ImageValidationFailure {
  ok: false;
  reason: string;
}

export type ImageValidation = { ok: true; image: ValidatedImage } | ImageValidationFailure;

export const MIN_PHOTO_BYTES = 8_000;
export const MIN_PHOTO_EDGE = 200;
/** Photographs are mostly smooth; a flat single-colour image is not a usable portrait. */
const MAX_FLATNESS = 0.10;

/**
 * Perceptual fingerprint, kept as two independent components:
 *  - aHash (64 bits): average brightness layout. Cheap, but uninformative for images that share
 *    a layout and differ only in colour.
 *  - dHash (120 bits): horizontal gradient. Much more discriminative for real photographs.
 *
 * Both are returned so duplicate detection can require agreement instead of being fooled by
 * one weak component.
 */
export interface PerceptualFingerprint {
  aHash: string;
  dHash: string;
  /** Combined value stored alongside the photo record. */
  combined: string;
}

export async function perceptualHash(input: {
  buffer: Buffer;
  width: number;
  height: number;
}): Promise<PerceptualFingerprint> {
  const gray = await sharp(input.buffer)
    .greyscale()
    .resize(17, 16, { fit: 'fill', kernel: 'cubic' })
    .raw()
    .toBuffer();

  const stride = 17;
  const dBits: number[] = [];
  for (let y = 0; y < 16; y += 1) {
    for (let x = 0; x < 16; x += 1) {
      dBits.push(gray[y * stride + x]! > gray[y * stride + x + 1]! ? 1 : 0);
    }
  }

  const small = await sharp(gray, { raw: { width: 17, height: 16, channels: 1 } })
    .resize(8, 8, { fit: 'fill' })
    .raw()
    .toBuffer();
  const aMean = small.reduce((a, b) => a + b, 0) / Math.max(1, small.length);
  const aBits: number[] = [];
  for (const v of small) aBits.push(v >= aMean ? 1 : 0);

  const aHash = bitsToHex(aBits);
  const dHash = bitsToHex(dBits);
  void input.width;
  void input.height;
  return { aHash, dHash, combined: `${aHash}${dHash}` };
}

function bitsToHex(bits: number[]): string {
  let hex = '';
  for (let i = 0; i < bits.length; i += 4) {
    hex += (((bits[i] ?? 0) << 3) | ((bits[i + 1] ?? 0) << 2) | ((bits[i + 2] ?? 0) << 1) | (bits[i + 3] ?? 0)).toString(16);
  }
  return hex;
}

/** Bit-level Hamming distance between two equal-length hex strings. */
export function hashDistance(a: string, b: string): number {
  if (!a || !b) return Number.POSITIVE_INFINITY;
  const len = Math.min(a.length, b.length);
  let distance = 0;
  for (let i = 0; i < len; i += 1) {
    let x = Number.parseInt(a[i] ?? '0', 16) ^ Number.parseInt(b[i] ?? '0', 16);
    while (x) {
      distance += x & 1;
      x >>= 1;
    }
  }
  return distance;
}

/**
 * Two uploads are the same image when the discriminative gradient fingerprint is very close
 * AND the brightness layout also matches. Requiring both avoids flagging genuinely different
 * photographs that happen to share a composition.
 */
export function isNearDuplicate(a: string, b: string): { duplicate: boolean; aDistance: number; dDistance: number } {
  const aLen = 16;
  const aHashA = a.slice(0, aLen);
  const dHashA = a.slice(aLen);
  const aHashB = b.slice(0, aLen);
  const dHashB = b.slice(aLen);
  const aDistance = hashDistance(aHashA, aHashB);
  const dDistance = hashDistance(dHashA, dHashB);
  return { duplicate: dDistance <= 10 && aDistance <= 12, aDistance, dDistance };
}

/** Channel standard deviation relative to mean — near-zero means a flat/blank image. */
async function flatness(buffer: Buffer): Promise<number> {
  const stats = await sharp(buffer).stats();
  const channels = stats.channels.slice(0, 3);
  const values: number[] = [];
  for (const c of channels) {
    const mean = c.mean ?? 0;
    const sd = Math.sqrt(Math.max(0, (c.stdev ?? 0) ** 2));
    values.push(mean > 0 ? sd / mean : 0);
  }
  return Math.min(...values);
}

export async function validateImage(
  input: { buffer: Buffer; filename: string },
): Promise<ImageValidation> {
  if (input.buffer.length === 0) {
    return { ok: false, reason: 'The file is empty.' };
  }
  let meta: sharp.Metadata;
  try {
    meta = await sharp(input.buffer, { failOn: 'none' }).metadata();
  } catch (err) {
    return {
      ok: false,
      reason: `This file is not a readable image (${err instanceof Error ? err.message : 'unknown format'}).`,
    };
  }
  if (!meta.format || !meta.width || !meta.height) {
    return { ok: false, reason: 'The image could not be decoded, so it cannot be published.' };
  }

  // `failOn: 'none'` deliberately tolerates minor corruption, but it also lets a heavily
  // truncated file decode to a full frame of invented pixels. Publishing that as a photograph of
  // a person would show a broken image, so the file is first required to decode strictly; only
  // then is the lenient path used to normalise it.
  try {
    await sharp(input.buffer, { failOn: 'error' }).raw().toBuffer();
  } catch {
    return {
      ok: false,
      reason: 'The image file is incomplete or corrupt, so it cannot be published.',
    };
  }
  if (input.buffer.length < MIN_PHOTO_BYTES) {
    return { ok: false, reason: `The file is only ${(input.buffer.length / 1024).toFixed(0)} KB, which is too small to be a usable photograph.` };
  }
  const longEdge = Math.max(meta.width, meta.height);
  const shortEdge = Math.min(meta.width, meta.height);
  if (longEdge < MIN_PHOTO_EDGE || shortEdge < 120) {
    return {
      ok: false,
      reason: `The image is ${meta.width}×${meta.height} pixels, which is too small to be a usable public photo (at least ${MIN_PHOTO_EDGE}px on the long edge).`,
    };
  }
  const flat = await flatness(input.buffer).catch(() => 0.5);
  if (flat < MAX_FLATNESS) {
    return {
      ok: false,
      reason:
        'The image appears to be a blank or single-colour graphic rather than a photograph of a person.',
    };
  }

  // Normalise orientation and strip metadata for privacy before storage.
  const normalised = await sharp(input.buffer, { failOn: 'none' })
    .rotate()
    .jpeg({ quality: 86, progressive: true })
    .toBuffer();
  const nmeta = await sharp(normalised).metadata();

  const ph = await perceptualHash({ buffer: normalised, width: nmeta.width ?? 0, height: nmeta.height ?? 0 });

  return {
    ok: true,
    image: {
      buffer: normalised,
      mime: 'image/jpeg',
      width: nmeta.width ?? meta.width,
      height: nmeta.height ?? meta.height,
      bytes: normalised.length,
      sha256: createHash('sha256').update(normalised).digest('hex'),
      perceptualHash: ph.combined,
      aHash: ph.aHash,
      dHash: ph.dHash,
      format: 'jpeg',
    },
  };
}

export interface PhotoQualification {
  qualifies: boolean;
  reasons: string[];
  disqualifyReasons: string[];
  representationStatus: 'primary' | 'supporting' | 'unverified' | 'rejected';
  inspectionDetail: Record<string, unknown>;
}

/** Decide whether a validated photo counts toward the internal minimum. */
export function qualifyPhoto(input: {
  image: ValidatedImage;
  existingHashes: { id: string; hash: string }[];
}): PhotoQualification {
  const { image } = input;
  const disqualifyReasons: string[] = [];
  const reasons: string[] = [];
  const longEdge = Math.max(image.width, image.height);
  const aspect = image.width / Math.max(1, image.height);

  if (image.bytes < MIN_PHOTO_BYTES) disqualifyReasons.push('The file is too small.');
  if (longEdge < MIN_PHOTO_EDGE) disqualifyReasons.push('The image resolution is too low for a public photo.');
  if (aspect < 0.4) disqualifyReasons.push('The image is extremely tall and narrow, which is unlikely to be a usable portrait.');
  if (aspect > 2.6) disqualifyReasons.push('The image is extremely wide, which is unlikely to be a usable portrait.');

  // Near-duplicate detection against already-uploaded photos.
  let nearest: { id: string; dDistance: number; aDistance: number } | null = null;
  for (const e of input.existingHashes) {
    const cmp = isNearDuplicate(image.perceptualHash, e.hash);
    if (!nearest || cmp.dDistance + cmp.aDistance < nearest.dDistance + nearest.aDistance) {
      nearest = { id: e.id, dDistance: cmp.dDistance, aDistance: cmp.aDistance };
    }
  }
  let duplicateOf: string | null = null;
  if (nearest && isNearDuplicate(image.perceptualHash, input.existingHashes.find((e) => e.id === nearest!.id)?.hash ?? '').duplicate) {
    duplicateOf = nearest.id;
    disqualifyReasons.push(
      'This photo looks identical to another photo already uploaded, so it is counted once.',
    );
  }

  const qualifies = disqualifyReasons.length === 0;
  if (qualifies) {
    reasons.push(`Valid ${image.width}×${image.height} photograph, stored as ${(image.bytes / 1024).toFixed(0)} KB.`);
    if (longEdge >= 900) reasons.push('High enough resolution to display well on the public site.');
  }

  return {
    qualifies,
    reasons,
    disqualifyReasons,
    representationStatus: qualifies ? (longEdge >= 700 ? 'primary' : 'supporting') : 'rejected',
    inspectionDetail: {
      width: image.width,
      height: image.height,
      bytes: image.bytes,
      format: image.format,
      perceptualHash: image.perceptualHash,
      aHash: image.aHash,
      dHash: image.dHash,
      duplicateOf,
      nearestDuplicateDistance: nearest ? { gradient: nearest.dDistance, brightness: nearest.aDistance } : null,
      checkedAt: new Date().toISOString(),
      // Face recognition is not performed. Recorded explicitly so no caller can assume it.
      faceVerification: {
        performed: false,
        reason:
          'Nexora Entity does not run biometric face matching. Photo qualification is based on technical validity and duplicate detection only, and a photo is never claimed to be verified as depicting a particular person by this check.',
      },
    },
  };
}