/**
 * Loading state for the readiness screen.
 *
 * A complete whole-entity review re-examines every claim, source and relationship on the entity,
 * so this screen can genuinely take many seconds. Without a boundary the person is left staring at
 * a blank frame and may reload mid-review. The placeholder holds the same shape as the finished
 * screen and states plainly what is happening, because an unexplained pause during a full review
 * reads as a failure.
 */
export default function ReadinessLoading() {
  return (
    <main id="main" className="nx-shell py-8" aria-busy="true" aria-live="polite">
      <span className="sr-only">Running the complete whole-entity review</span>
      <div className="nx-stack nx-stack--loose">
        <div>
          <div className="nx-skeleton h-3 w-36" />
          <div className="nx-skeleton mt-2 h-9 w-64 max-w-full" />
          <div className="nx-skeleton nx-mono mt-2 h-3 w-40" />
        </div>

        <div className="nx-notice nx-notice--info">
          <p className="text-sm font-medium text-ink-800">Running the complete whole-entity review…</p>
          <p className="mt-1 text-xs leading-relaxed">
            This pass re-examines your entire entity from the beginning rather than only the field you last changed. It
            takes longer than the rest of the studio, and nothing you have entered is affected while it runs.
          </p>
        </div>

        <div className="nx-card nx-card--pad nx-stack">
          <div className="nx-skeleton h-3 w-20" />
          <div className="nx-skeleton h-8 w-72 max-w-full" />
          <div className="nx-skeleton h-2 w-full" />
          <div className="nx-skeleton h-4 w-3/4" />
        </div>

        <div className="grid gap-4 sm:grid-cols-3">
          <div className="nx-skeleton h-28" />
          <div className="nx-skeleton h-28" />
          <div className="nx-skeleton h-28" />
        </div>

        <div className="nx-skeleton h-64" />
      </div>
    </main>
  );
}