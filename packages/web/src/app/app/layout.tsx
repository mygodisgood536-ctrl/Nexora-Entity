import Link from 'next/link';
import { redirect } from 'next/navigation';
import { PRODUCT_NAME } from '@nexora/core';
import { listEntitiesForUser } from '@nexora/db';
import { requireUser } from '@/lib/server';

export const dynamic = 'force-dynamic';

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser('/app');
  const entities = await listEntitiesForUser(user.id);
  const header = (
    <header className="sticky top-0 z-40 border-b border-ink-100 bg-white/90 backdrop-blur">
      <div className="nx-shell flex flex-wrap items-center justify-between gap-3 py-3">
        <div className="flex min-w-0 items-center gap-3">
          <Link href="/app" className="flex flex-none items-center gap-2.5 no-underline">
            <span
              aria-hidden="true"
              className="grid h-8 w-8 place-items-center rounded-lg bg-gradient-to-br from-ink-900 to-ink-600 text-[0.65rem] font-bold text-white"
            >
              NE
            </span>
            <span className="hidden font-semibold tracking-tight text-ink-900 sm:inline">{PRODUCT_NAME}</span>
          </Link>
          <nav className="flex min-w-0 items-center gap-1 text-sm">
            <Link href="/app" className="rounded-full px-3 py-1.5 text-ink-500 no-underline hover:bg-ink-50 hover:text-ink-900">
              Entities
            </Link>
            {entities[0] ? (
              <>
                <Link
                  href={`/app/stages/${entities[0].slug}`}
                  className="rounded-full px-3 py-1.5 text-ink-500 no-underline hover:bg-ink-50 hover:text-ink-900"
                >
                  Build
                </Link>
                <Link
                  href={`/app/review?entity=${entities[0].id}`}
                  className="rounded-full px-3 py-1.5 text-ink-500 no-underline hover:bg-ink-50 hover:text-ink-900"
                >
                  Review
                </Link>
                <Link
                  href={`/app/readiness?entity=${entities[0].id}`}
                  className="rounded-full px-3 py-1.5 text-ink-500 no-underline hover:bg-ink-50 hover:text-ink-900"
                >
                  Readiness
                </Link>
                <Link
                  href={`/app/publish?entity=${entities[0].id}`}
                  className="rounded-full px-3 py-1.5 text-ink-500 no-underline hover:bg-ink-50 hover:text-ink-900"
                >
                  Publish
                </Link>
              </>
            ) : null}
          </nav>
        </div>
        <div className="flex items-center gap-3">
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

  void redirect;
  return (
    <div className="min-h-screen pb-24">
      {header}
      {children}
    </div>
  );
}