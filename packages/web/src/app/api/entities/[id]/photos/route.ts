import { NextResponse } from 'next/server';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { config } from '@nexora/core/config';
import { StorageError, toActionableError } from '@nexora/core';
import {
  findEntityForUser,
  insertPhoto,
  query,
  updatePhotoAssessment,
} from '@nexora/db';
import { qualifyPhoto, validateImage } from '@nexora/inspect';
import { requireUser } from '@/lib/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MAX_BYTES = 15 * 1024 * 1024;

/**
 * Photo upload.
 *
 * Each file is genuinely decoded and validated. Duplicate detection uses a perceptual
 * fingerprint, so re-uploading the same photograph is rejected honestly rather than counted
 * twice. Nothing about a person's appearance is inferred.
 */
export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const { id: entityId } = await ctx.params;
  const entity = await findEntityForUser(entityId, user.id);
  if (!entity) return NextResponse.json({ ok: false, error: { message: 'That entity is not yours.' } }, { status: 403 });

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json({ ok: false, error: StorageError('The upload could not be read.').toJSON() }, { status: 400 });
  }

  const files = form.getAll('files').filter((f): f is File => typeof File !== 'undefined' && f instanceof File);
  if (files.length === 0) {
    return NextResponse.json({ ok: false, error: StorageError('No image was uploaded.').toJSON() }, { status: 400 });
  }

  const cfg = config();
  const photoDir = path.join(cfg.repoRoot, cfg.photoDir.replace(/^.*?(photos)$/i, '$1').replace(/^photos$/, 'photos'));
  await mkdir(photoDir, { recursive: true });

  const results: { label: string; ok: boolean; detail: string }[] = [];

  for (const file of files) {
    if (file.size > MAX_BYTES) {
      results.push({
        label: file.name,
        ok: false,
        detail: `The file is ${(file.size / 1024 / 1024).toFixed(1)} MB, above the ${MAX_BYTES / 1024 / 1024} MB limit.`,
      });
      continue;
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    const validated = await validateImage({ buffer, filename: file.name });
    if (!validated.ok) {
      results.push({ label: file.name, ok: false, detail: validated.reason });
      continue;
    }

    const fileName = `${entity.slug}-${validated.image.sha256.slice(0, 16)}.jpg`;
    await writeFile(path.join(photoDir, fileName), validated.image.buffer);

    const rec = await insertPhoto({
      entityId,
      storagePath: path.join('photos', fileName),
      publicUrl: `/media/photos/${fileName}`,
      originalFilename: file.name,
      mime: validated.image.mime,
      bytes: validated.image.bytes,
      width: validated.image.width,
      height: validated.image.height,
      sha256: validated.image.sha256,
      perceptualHash: validated.image.perceptualHash,
    });

    const existing = await query<{ id: string; perceptual_hash: string }>(
      'SELECT id, perceptual_hash FROM photos WHERE entity_id = $1 AND id <> $2',
      [entityId, rec.id],
    );

    const q = qualifyPhoto({
      image: validated.image,
      existingHashes: existing.map((r) => ({ id: r.id, hash: r.perceptual_hash ?? '' })),
    });

    await updatePhotoAssessment({
      photoId: rec.id,
      representationStatus: q.representationStatus,
      inspectionStatus: 'inspected',
      inspectionDetail: q.inspectionDetail,
      qualifies: q.qualifies,
      disqualifyReasons: q.disqualifyReasons,
    });

    results.push({
      label: file.name,
      ok: q.qualifies,
      detail: q.qualifies
        ? `Valid ${validated.image.width}x${validated.image.height} photograph.`
        : q.disqualifyReasons[0] ?? 'Not counted.',
    });
  }

  return NextResponse.json({ ok: true, data: { results } });
}

export { toActionableError };