'use client';

import Link from 'next/link';

/**
 * Global error boundary.
 *
 * A failure in one screen must never take the whole platform down: this renders a recoverable
 * state with a real retry (React's `reset`) and a way out. The message is deliberately generic —
 * internal error details are never shown to the person — and the digest is surfaced so a support
 * request can be matched to the server log.
 */
export default function Error({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <main id="main" className="nx-shell flex min-h-screen flex-col items-center justify-center py-20 text-center">
      <p className="nx-eyebrow">Something went wrong</p>
      <h1 className="nx-display mt-2">This Screen Could Not Be Shown.</h1>
      <p className="nx-subtitle mt-4">
        Nothing you have entered has been lost. Try again, and if it keeps failing, come back to your entities and
        continue from there.
      </p>
      {error.digest ? <p className="nx-help nx-mono mt-3">Reference: {error.digest}</p> : null}
      <div className="nx-row mt-6 justify-center">
        <button type="button" className="nx-btn nx-btn--accent" onClick={() => reset()}>
          Try again
        </button>
        <Link href="/app" className="nx-btn nx-btn--ghost">
          Back to your entities
        </Link>
      </div>
    </main>
  );
}
