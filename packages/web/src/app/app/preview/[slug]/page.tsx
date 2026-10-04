import Link from 'next/link';
import { config } from '@nexora/core/config';
import { findEntityForUser, listEntitiesForUser } from '@nexora/db';
import { buildArtefact } from '@nexora/deploy';
import { requireUser } from '@/lib/server';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

export default async function FullPreviewPage({ params }: { params: Promise<Record<string, string | string[] | undefined>> }) {
  const user = await requireUser();
  const routeParams = await params;
  const slugParam = Array.isArray(routeParams['slug']) ? routeParams['slug'][0] : routeParams['slug'];
  if (!slugParam) return <p className="nx-shell py-10">Not found</p>;

  const entities = await listEntitiesForUser(user.id);
  const entity =
    entities.find((e) => e.slug === slugParam || e.id === slugParam) ?? entities[0];
  if (!entity) return <p className="nx-shell py-10">Not found</p>;
  void findEntityForUser;

  const artefact = await buildArtefact({
    entityId: entity.id,
    canonicalUrl: `${config().platformOrigin}/e/${entity.slug}`,
    mediaBase: `${config().platformOrigin}/media`,
    published: false,
  });

  const html = artefact.html.replace('</body>', `${BRIDGE}</body>`);

  return (
    <>
      <div className="nx-no-print nx-shell flex flex-wrap items-center justify-between gap-3 border-b border-ink-100 py-3">
        <div className="flex items-center gap-2">
          <Link href={`/app/stages/A_identity?entity=${entity.id}`} className="nx-btn nx-btn--ghost nx-btn--sm">
            Back to building
          </Link>
          <span className="nx-help">Preview &middot; not published</span>
        </div>
        <div className="nx-row">
          <span className="nx-badge">{artefact.model.sections.length} sections</span>
          <span className="nx-badge">{Math.round(Buffer.byteLength(artefact.html, 'utf8') / 1024)} KB</span>
        </div>
      </div>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <iframe
        title="Entity Website preview"
        src={`/api/preview/${entity.id}`}
        style={{ width: '100%', height: '85vh', border: 0 }}
        sandbox="allow-same-origin"
      />
    </>
  );
}

const BRIDGE = `<script>
(function () {
  function send() { try { parent.postMessage({ type: 'nexora:entity-preview-height', height: document.documentElement.scrollHeight }, '*'); } catch (e) {} }
  if (window.ResizeObserver) { new ResizeObserver(send).observe(document.body); }
  setInterval(send, 500);
})();
</script>`;