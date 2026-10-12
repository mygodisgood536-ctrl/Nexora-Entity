import { NextResponse } from 'next/server';
import { createReadStream, existsSync, statSync } from 'node:fs';
import path from 'node:path';
import { Readable } from 'node:stream';
import { config } from '@nexora/core/config';

export const runtime = 'nodejs';

/**
 * Serves uploaded photos from the secure photo store with long-lived caching.
 * Paths are resolved and confined to the photo directory, so nothing outside it is reachable.
 */
export async function GET(request: Request, ctx: { params: Promise<{ path: string[] }> }) {
  const { path: segments } = await ctx.params;
  const rel = segments.join('/');
  // `config().photoDir` is already absolute; use it directly so NEXORA_PHOTO_DIR is honoured.
  const root = path.resolve(config().photoDir);
  const target = path.resolve(root, rel.replace(/^\/+/, ''));

  if (!target.startsWith(root) || !existsSync(target) || !statSync(target).isFile()) {
    return new NextResponse('Not found', { status: 404 });
  }

  const ext = path.extname(target).toLowerCase();
  const type =
    ext === '.jpg' || ext === '.jpeg'
      ? 'image/jpeg'
      : ext === '.png'
        ? 'image/png'
        : ext === '.webp'
          ? 'image/webp'
          : ext === '.avif'
            ? 'image/avif'
            : 'application/octet-stream';

  const stat = statSync(target);
  const stream = Readable.toWeb(createReadStream(target)) as unknown as ReadableStream;

  return new NextResponse(stream, {
    status: 200,
    headers: {
      'content-type': type,
      'content-length': String(stat.size),
      'cache-control': 'public, max-age=31536000, immutable',
      'x-content-type-options': 'nosniff',
    },
  });
}