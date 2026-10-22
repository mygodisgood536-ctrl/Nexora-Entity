import { NextResponse } from 'next/server';
import { config } from '@nexora/core/config';
import { storage } from '@/lib/storage';

export const runtime = 'nodejs';

/**
 * Serves uploaded photos from the secure store with long-lived caching.
 *
 * The bytes come from the configured storage driver, so the same route works whether uploads live
 * on the local disk or in an object bucket. The key is confined to the storage root, so nothing
 * outside it is reachable.
 */
export async function GET(request: Request, ctx: { params: Promise<{ path: string[] }> }) {
  const { path: segments } = await ctx.params;
  const rel = segments.join('/').replace(/^\/+/, '');
  if (!rel) {
    return new NextResponse('Not found', { status: 404 });
  }

  // The local driver resolves and checks the key against its root; the object driver addresses a
  // bucket key directly. Either way a key that tries to escape is refused.
  let object: { body: Buffer; contentType: string } | null = null;
  try {
    object = await storage().get(rel);
  } catch {
    return new NextResponse('Not found', { status: 404 });
  }
  if (!object) {
    return new NextResponse('Not found', { status: 404 });
  }

  return new NextResponse(new Uint8Array(object.body), {
    status: 200,
    headers: {
      'content-type': object.contentType,
      'content-length': String(object.body.length),
      'cache-control': 'public, max-age=31536000, immutable',
      'x-content-type-options': 'nosniff',
    },
  });
}

/** The storage root the local driver is confined to, exposed for diagnostics only. */
export function storageRoot(): string {
  return config().storageDir;
}
