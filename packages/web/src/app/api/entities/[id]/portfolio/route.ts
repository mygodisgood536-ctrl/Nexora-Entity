import { NextResponse } from 'next/server';
import path from 'node:path';
import { StorageError, createLogger } from '@nexora/core';
import { findEntityForUser, insertPortfolioFile, insertReviewItem, updatePortfolioExtraction } from '@nexora/db';
import { extractPortfolio, portfolioCandidates, portfolioFingerprint } from '@nexora/inspect';
import { requireUser } from '@/lib/server';
import { storage } from '@/lib/storage';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const log = createLogger('api:portfolio');
const MAX_BYTES = 25 * 1024 * 1024;

/**
 * Portfolio upload.
 *
 * The file is genuinely read (PDF text extraction, DOCX, Markdown, text, CSV, images). What is
 * found is stored as user-provided evidence with provenance, and every discovery is queued for
 * the person's review. Nothing from a portfolio is published automatically.
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
    return NextResponse.json({ ok: false, error: StorageError('No portfolio file was uploaded.').toJSON() }, { status: 400 });
  }

  const results: { label: string; ok: boolean; detail: string }[] = [];
  const allCandidates: { value: string; context: string }[] = [];

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
    const sha = portfolioFingerprint(buffer);
    const storedName = `${entity.slug}-${sha.slice(0, 12)}-${path.basename(file.name).replace(/[^\w.-]+/g, '_')}`;
    // The file is written through the configured storage driver, so a hosted deployment keeps
    // portfolios in a bucket rather than on an ephemeral disk.
    const key = path.posix.join('portfolios', storedName);
    await storage().put(key, buffer, file.type || 'application/octet-stream');

    const extraction = await extractPortfolio({ buffer, filename: file.name, mime: file.type || null });

    const rec = await insertPortfolioFile({
      entityId,
      originalFilename: file.name,
      mime: file.type || 'application/octet-stream',
      bytes: buffer.length,
      storagePath: key,
      sha256: sha,
    });

    await updatePortfolioExtraction({
      fileId: rec.id,
      status: extraction.status,
      extraction: extraction.extraction,
      error: extraction.error ?? null,
    });

    const candidates = extraction.status === 'extracted' ? portfolioCandidates(extraction.extraction) : [];
    allCandidates.push(...candidates.map((c) => ({ value: c.value, context: c.context })));

    for (const c of candidates.slice(0, 25)) {
      await insertReviewItem({
        entityId,
        kind: 'portfolio_discovery',
        title: `From your portfolio: ${c.value.slice(0, 90)}`,
        detail: `${c.context}\n\nThis came from a file you uploaded, so it is treated as information you supplied rather than independently verified fact. Accept it to use it, or reject it.`,
        proposed: { value: c.value, kind: c.kind, source: 'portfolio', file: rec.id, section: c.section ?? null },
        stageKey: 'O_portfolio',
        blocking: false,
      });
    }

    results.push({
      label: file.name,
      ok: extraction.status === 'extracted',
      detail:
        extraction.status === 'extracted'
          ? `Read ${extraction.extraction.textLength ?? 0} characters, ${(extraction.extraction.links ?? []).length} link(s), ${candidates.length} item(s) queued for your review.`
          : extraction.status === 'unsupported'
            ? (extraction.extraction.warnings?.[0] ?? 'This file type cannot be read.')
            : (extraction.error ?? 'The file could not be read.'),
    });
  }

  log.info('portfolio uploaded', { entityId, files: files.length, candidates: allCandidates.length });

  return NextResponse.json({ ok: true, data: { results, candidates: allCandidates } });
}