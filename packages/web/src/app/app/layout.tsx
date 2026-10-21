import Link from 'next/link';
import { cookies } from 'next/headers';
import { PRODUCT_NAME, STAGES } from '@nexora/core';
import { listEntitiesForUser, listStageProgress } from '@nexora/db';
import { requireUser } from '@/lib/server';
import EntitySwitcher from '@/components/entity-switcher';

export const dynamic = 'force-dynamic';

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser('/app');
  const entities = await listEntitiesForUser(user.id);
  // The active entity is a stored preference, so switching entity on any screen carries across
  // the whole studio instead of resetting to the first entity on every navigation.
  const store = await cookies();
  const activeId = store.get('nexora_active_entity')?.value;
  const current = entities.find((e) => e.id === activeId) ?? entities[0];

  // "Build" resumes at the first stage that is not yet complete rather than always resetting the
  // person to stage A, so returning to the platform lands them where they actually stopped.
  let buildHref: string | null = null;
  if (current) {
    const progress = await listStageProgress(current.id);
    const firstOpen = STAGES.find((s) => progress.find((p) => p.stage_key === s.key)?.status !== 'complete');
    buildHref = `/app/stages/${firstOpen?.key ?? STAGES[0]?.key ?? 'A_identity'}?entity=${current.id}`;
  }

  const header = (
    <header className="sticky top-0 z-40 border-b border-ink-100 bg-[#070a12]/80 backdrop-blur-xl">
      <div className="nx-shell flex flex-wrap items-center justify-between gap-3 py-3">
        <div className="flex min-w-0 items-center gap-3">
          <Link href="/app" className="flex flex-none items-center gap-2.5 no-underline">
            <span
              aria-hidden="true"
              className="grid h-8 w-8 place-items-center rounded-lg bg-gradient-to-br from-accent-600 to-teal-700 text-[0.65rem] font-bold text-ink-950"
            >
              NE
            </span>
            <span className="hidden font-display text-[1.05rem] tracking-tight text-ink-900 sm:inline">{PRODUCT_NAME}</span>
          </Link>
          <nav className="flex flex-wrap min-w-0 items-center gap-1 text-sm">
            <Link href="/app" className="rounded-full px-3 py-1.5 text-ink-500 no-underline hover:bg-ink-50 hover:text-ink-900">
              Entities
            </Link>
            {current ? (
              <>
                <Link
                  href={buildHref ?? '/app'}
                  className="rounded-full px-3 py-1.5 text-ink-500 no-underline hover:bg-ink-50 hover:text-ink-900"
                >
                  Build
                </Link>
                <Link
                  href={`/app/review?entity=${current.id}`}
                  className="rounded-full px-3 py-1.5 text-ink-500 no-underline hover:bg-ink-50 hover:text-ink-900"
                >
                  Review
                </Link>
                <Link
                  href={`/app/readiness?entity=${current.id}`}
                  className="rounded-full px-3 py-1.5 text-ink-500 no-underline hover:bg-ink-50 hover:text-ink-900"
                >
                  Readiness
                </Link>
                <Link
                  href={`/app/publish?entity=${current.id}`}
                  className="rounded-full px-3 py-1.5 text-ink-500 no-underline hover:bg-ink-50 hover:text-ink-900"
                >
                  Publish
                </Link>
              </>
            ) : null}
          </nav>
        </div>
        <div className="flex items-center gap-3">
          <EntitySwitcher
            entities={entities.map((e) => ({ id: e.id, displayName: e.display_name }))}
            activeId={current?.id}
          />
          <span className="hidden text-xs text-ink-400 sm:inline">
            {user.full_name} &middot; @{user.username}
          </span>
          <form action="/api/auth/logout" method="post">
            <button type="submit" className="nx-btn nx-btn--ghost nx-btn--sm">
              Sign out
            </button>
          </form>
        </div>
      </div>
    </header>
  );

  return (
    <div className="min-h-screen pb-24">
      {header}
      {children}
    </div>
  );
}