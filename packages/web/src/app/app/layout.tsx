import Link from 'next/link';
import { cookies } from 'next/headers';
import { PRODUCT_NAME, STAGES } from '@nexora/core';
import { listEntitiesForUser, listStageProgress } from '@nexora/db';
import { requireUser } from '@/lib/server';
import EntitySwitcher from '@/components/entity-switcher';
import ThemeToggle from '@/components/theme-toggle';

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

  const entityQuery = current ? `?entity=${current.id}` : '';

  const header = (
    <header className="sticky top-0 z-40 border-b border-ink-100 bg-paper/85 backdrop-blur-xl">
      <div className="nx-shell flex flex-wrap items-center gap-x-4 gap-y-3 py-3">
        <div className="flex min-w-0 flex-1 items-center gap-x-4 gap-y-2">
          <Link href="/app" className="flex flex-none items-center gap-2.5 no-underline">
            <span
              aria-hidden="true"
              className="nx-brandmark grid h-8 w-8 place-items-center rounded-lg text-[0.65rem] font-bold"
            >
              NE
            </span>
            <span className="hidden font-display text-[1.05rem] tracking-tight text-ink-900 sm:inline">{PRODUCT_NAME}</span>
          </Link>

          <nav aria-label="Studio" className="flex min-w-0 flex-wrap items-center gap-1 text-sm">
            <Link
              href="/app"
              className="rounded-full px-3 py-1.5 text-ink-500 no-underline transition hover:bg-ink-50 hover:text-ink-900"
            >
              Entities
            </Link>
            {current ? (
              <>
                <Link
                  href={buildHref ?? '/app'}
                  className="rounded-full px-3 py-1.5 text-ink-500 no-underline transition hover:bg-ink-50 hover:text-ink-900"
                >
                  Build
                </Link>
                <Link
                  href={`/app/review${entityQuery}`}
                  className="rounded-full px-3 py-1.5 text-ink-500 no-underline transition hover:bg-ink-50 hover:text-ink-900"
                >
                  Review
                </Link>
                <Link
                  href={`/app/readiness${entityQuery}`}
                  className="rounded-full px-3 py-1.5 text-ink-500 no-underline transition hover:bg-ink-50 hover:text-ink-900"
                >
                  Readiness
                </Link>
                <Link
                  href={`/app/publish${entityQuery}`}
                  className="rounded-full px-3 py-1.5 text-ink-500 no-underline transition hover:bg-ink-50 hover:text-ink-900"
                >
                  Publish
                </Link>
              </>
            ) : null}
            <Link
              href="/app/settings"
              className="rounded-full px-3 py-1.5 text-ink-500 no-underline transition hover:bg-ink-50 hover:text-ink-900"
            >
              Settings
            </Link>
          </nav>
        </div>

        <div className="flex flex-none items-center gap-2 sm:gap-3">
          <EntitySwitcher
            entities={entities.map((e) => ({ id: e.id, displayName: e.display_name }))}
            activeId={current?.id}
          />
          <ThemeToggle />
          <Link
            href="/app/settings"
            className="hidden max-w-[14rem] truncate rounded-full px-2 py-1 text-xs text-ink-500 no-underline transition hover:bg-ink-50 hover:text-ink-900 sm:inline"
          >
            {user.full_name}
          </Link>
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
