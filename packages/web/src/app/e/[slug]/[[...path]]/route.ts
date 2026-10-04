import { NextResponse } from 'next/server';
import { readFile } from 'node:fs/promises';
import { cacheHeadersFor, resolveReleaseFileForSlug } from '@nexora/deploy';
import { findEntityBySlug } from '@nexora/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function notFound(message: string) {
  return new NextResponse(message, {
    status: 404,
    headers: { 'content-type': 'text/plain; charset=utf-8', 'x-robots-tag': 'noindex, nofollow' },
  });
}

/**
 * Serve a published Entity Website by slug from the platform's own hosting tier.
 *
 * All release resolution lives in the deploy layer (`resolveReleaseFileForSlug`), so this route
 * cannot drift from where releases are actually written. Only entities with a live release are
 * served, so an unpublished entity never leaks a page.
 */
export async function GET(_request: Request, ctx: { params: Promise<{ slug: string; path?: string[] }> }) {
  const { slug, path: segments } = await ctx.params;

  const entity = await findEntityBySlug(slug);
  if (!entity) return notFound('This Entity Website is not available.');

  const pathname = segments && segments.length > 0 ? `/${segments.join('/')}` : '/';
  const resolved = await resolveReleaseFileForSlug(slug, pathname);
  if (!resolved) return notFound('This Entity Website has not been published yet.');

  const body = await readFile(resolved.file).catch(() => null);
  if (!body) return notFound('Not found');

  return new NextResponse(body, {
    status: 200,
    headers: {
      'content-type': resolved.contentType,
      ...cacheHeadersFor(resolved.file),
      'x-content-type-options': 'nosniff',
      'referrer-policy': 'strict-origin-when-cross-origin',
      'x-nexora-entity': `release:${resolved.releaseId}`,
    },
  });
}