/**
 * Loading state for the authenticated studio.
 *
 * This boundary deliberately sits *inside* the studio segment rather than at the application root.
 * A root-level `loading.tsx` wraps every route in a Suspense boundary, which means Next commits a
 * 200 response with the shell before the studio layout has run its ownership check — so an
 * anonymous request to `/app` answered "200 OK" with a page shell instead of the redirect that
 * actually sent them to `/login`. Putting the boundary here keeps the loading experience for
 * screens whose layout has already established that the caller owns the account, while leaving the
 * layout's redirect intact (verified by `scripts/smoke-http.ts`).
 *
 * It reserves the shape of the dashboard rather than spinning: a heading, the readiness card and
 * the three evidence tiles, so the screen does not jump when the real content arrives.
 */
export default function StudioLoading() {
  return (
    <main id="main" className="nx-shell py-8" aria-busy="true" aria-live="polite">
      <span className="sr-only">Loading your entity</span>
      <div className="grid gap-6 lg:grid-cols-[1.4fr_0.9fr]">
        <div className="nx-stack nx-stack--loose">
          <div>
            <div className="nx-skeleton h-3 w-24" />
            <div className="nx-skeleton mt-2 h-9 w-72 max-w-full" />
            <div className="nx-skeleton nx-mono mt-2 h-3 w-56 max-w-full" />
          </div>
          <div className="nx-card nx-card--pad nx-stack">
            <div className="nx-skeleton h-3 w-32" />
            <div className="nx-skeleton h-8 w-64 max-w-full" />
            <div className="nx-skeleton h-2 w-full" />
            <div className="nx-skeleton h-4 w-4/5" />
            <div className="nx-row mt-1">
              <div className="nx-skeleton nx-skeleton--bar w-36" />
              <div className="nx-skeleton nx-skeleton--bar w-32" />
            </div>
          </div>
          <div className="grid gap-4 sm:grid-cols-3">
            <div className="nx-skeleton h-28" />
            <div className="nx-skeleton h-28" />
            <div className="nx-skeleton h-28" />
          </div>
        </div>
        <aside className="nx-stack">
          <div className="nx-skeleton h-44" />
          <div className="nx-skeleton h-32" />
          <div className="nx-skeleton h-40" />
        </aside>
      </div>
    </main>
  );
}