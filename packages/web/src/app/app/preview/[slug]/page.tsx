import Link from 'next/link';
import { findEntityForUser, listEntitiesForUser } from '@nexora/db';
import { requireUser } from '@/lib/server';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

/**
 * Full-page preview of the public Entity Website.
 *
 * The preview itself is served by `/api/preview/[id]`, which owns entity access control and
 * renders through the same out-of-process renderer the published site uses. This page is only
 * the frame and its chrome, so it deliberately does not build an artefact of its own — doing so
 * would render the whole entity twice and would require the renderer subprocess on a runtime
 * that may not permit spawning one.
 */
export default async function FullPreviewPage({ params }: { params: Promise<Record<string, string | string[] | undefined>> }) {
  const user = await requireUser();
  const routeParams = await params;
  const slugParam = Array.isArray(routeParams['slug']) ? routeParams['slug'][0] : routeParams['slug'];
  if (!slugParam) return <p className="nx-shell py-10">Not found</p>;

  // Prefer an ownership-checked lookup by id; fall back to this account's slug list. If neither
  // matches, say so rather than silently substituting a different entity.
  const entity = (await findEntityForUser(slugParam, user.id)) ?? (await listEntitiesForUser(user.id)).find((e) => e.slug === slugParam);
  if (!entity) return <p className="nx-shell py-10">Not found</p>;

  return (
    <>
      <div className="nx-no-print nx-shell flex flex-wrap items-center justify-between gap-3 border-b border-ink-100 py-3">
        <div className="flex items-center gap-2">
          <Link href={`/app/stages/A_identity?entity=${entity.id}`} className="nx-btn nx-btn--ghost nx-btn--sm">
            Back to building
          </Link>
          <span className="nx-help">Preview &middot; not published</span>
        </div>
        <span className="nx-help">
          This is the same design system that gets published. Sections appear only where your verified information
          supports them.
        </span>
      </div>
      <iframe
        title="Entity Website preview"
        src={`/api/preview/${entity.id}`}
        className="nx-frame"
        sandbox="allow-same-origin"
      />
    </>
  );
}