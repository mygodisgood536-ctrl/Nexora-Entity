import Link from 'next/link';

/** Global 404. Plain, navigable, and never a dead end. */
export default function NotFound() {
  return (
    <main id="main" className="nx-shell flex min-h-screen flex-col items-center justify-center py-20 text-center">
      <p className="nx-eyebrow">Not found</p>
      <h1 className="nx-display mt-2">This page does not exist.</h1>
      <p className="nx-subtitle mt-4">
        The address may be mistyped, or the page may have moved. Nothing you have saved is affected.
      </p>
      <div className="nx-row mt-6 justify-center">
        <Link href="/app" className="nx-btn nx-btn--accent">
          Go to your entities
        </Link>
        <Link href="/" className="nx-btn nx-btn--ghost">
          Back to the homepage
        </Link>
      </div>
    </main>
  );
}
