import { NextResponse } from 'next/server';
import { config } from '@nexora/core/config';
import { findEntityById } from '@nexora/db';
import { buildArtefact } from '@nexora/deploy';
import { requireUser } from '@/lib/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Live preview of the public Entity Website, rendered from the same design system that gets
 * deployed. Always `noindex`, and never a published URL.
 */
export async function GET(_request: Request, ctx: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const { id } = await ctx.params;
  const entity = await findEntityById(id);
  if (!entity || entity.user_id !== user.id) {
    return new NextResponse('Not found', { status: 404 });
  }

  try {
    const artefact = await buildArtefact({
      entityId: id,
      canonicalUrl: `${config().platformOrigin}/e/${entity.slug}`,
      mediaBase: `${config().platformOrigin}/media`,
      published: false,
    });

    const html = artefact.html
      // The preview bridge reports its height to the parent frame. It must be appended after
      // renderEntitySite produced the document.
      .replace('</body>', `${PREVIEW_BRIDGE}</body>`);

    return new NextResponse(html, {
      status: 200,
      headers: {
        'content-type': 'text/html; charset=utf-8',
        'cache-control': 'no-store, max-age=0',
        'x-robots-tag': 'noindex, nofollow',
        'content-security-policy': "frame-ancestors 'self'; img-src 'self' data:; style-src 'unsafe-inline'",
      },
    });
  } catch (err) {
    const { toActionableError } = await import('@nexora/core');
    const error = toActionableError(err);
    return NextResponse.json({ ok: false, error }, { status: error.status });
  }
}

const PREVIEW_BRIDGE = `<script>
(function () {
  function send() {
    try {
      parent.postMessage({ type: 'nexora:entity-preview-height', height: document.documentElement.scrollHeight }, '*');
    } catch (e) {}
  }
  if (window.ResizeObserver) { new ResizeObserver(send).observe(document.body); }
  window.addEventListener('load', send);
  setInterval(send, 500);
})();
</script>`;