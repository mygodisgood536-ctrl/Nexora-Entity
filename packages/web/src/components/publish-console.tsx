'use client';

import { useState } from 'react';
import type { ActionableErrorShape } from '@nexora/core';

interface Props {
  entityId: string;
  slug: string;
  canPublish: boolean;
  availableTarget: string;
  vercelDetail: string;
  initialUrl: string | null;
  initialTarget: string | null;
}

interface DeploymentResult {
  url: string;
  target: string;
  validation: { ok: boolean; checks: { name: string; ok: boolean; detail: string }[] };
  log: string;
}

/**
 * Publish console.
 *
 * The gate is enforced server-side: even if the button is present, the server refuses to deploy
 * an entity that has not passed 100% Entity Readiness. Failures are shown with their real
 * reason, and a deployment is only reported as live once validation passed and the site was
 * actually published.
 */
export default function PublishConsole({
  entityId,
  slug,
  canPublish,
  availableTarget,
  vercelDetail,
  initialUrl,
  initialTarget,
}: Props) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<ActionableErrorShape | null>(null);
  const [result, setResult] = useState<DeploymentResult | null>(
    initialUrl ? { url: initialUrl, target: initialTarget ?? availableTarget, validation: { ok: true, checks: [] }, log: '' } : null,
  );

  async function publish() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/publish', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ entityId, target: availableTarget }),
      });
      const body = (await res.json()) as { ok: boolean; error?: ActionableErrorShape; data?: DeploymentResult };
      if (!body.ok) {
        setError(body.error ?? null);
        return;
      }
      setResult(body.data ?? null);
    } catch {
      setError({
        code: 'network',
        domain: 'system',
        message: 'The deployment request could not be sent. Nothing has been published and nothing was lost.',
        retryable: true,
        remediation: [{ kind: 'retry', label: 'Try again', primary: true }],
        preservesUserProgress: true,
        severity: 'warning',
        status: 502,
        occurredAt: new Date().toISOString(),
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="nx-stack" style={{ gap: '0.75rem' }}>
      <section className="nx-card nx-card--pad nx-stack">
        <div className="nx-row justify-between">
          <div>
            <p className="nx-eyebrow">Hosting</p>
            <p className="text-sm font-medium text-ink-800">
              {availableTarget === 'vercel' ? 'Vercel (platform credential)' : 'Nexora Entity platform hosting'}
            </p>
          </div>
          <span className="nx-badge">{availableTarget === 'vercel' ? 'Vercel' : 'First-party'}</span>
        </div>
        <p className="nx-help">{vercelDetail}</p>
        <div className="nx-row">
          <button
            type="button"
            className="nx-btn nx-btn--accent"
            disabled={!canPublish || busy}
            onClick={() => void publish()}
            title={canPublish ? undefined : 'This entity has not reached 100% Entity Readiness.'}
          >
            {busy ? 'Publishing…' : initialUrl ? 'Publish an update' : 'Publish now'}
          </button>
          {!canPublish ? (
            <span className="nx-help">Publishing is unavailable until this entity reaches 100% Entity Readiness.</span>
          ) : null}
        </div>
      </section>

      {error ? (
        <div className="nx-notice nx-notice--stop" role="alert">
          <p className="font-semibold">{error.message}</p>
          {error.detail ? <p className="mt-1 text-xs">{error.detail}</p> : null}
          <p className="mt-1 text-xs">Nothing was published. Your entity information is unchanged.</p>
          <div className="nx-row mt-2">
            {/* A retry action has no destination: rendering it as an <a href="#"> produced a
                control that looked actionable and navigated nowhere. Only remediation that
                actually names a target becomes a link. */}
            {error.remediation.map((r, i) =>
              r.href ? (
                <a
                  key={r.kind + i}
                  href={r.href}
                  className={`nx-btn nx-btn--sm ${r.primary ? 'nx-btn--primary' : 'nx-btn--ghost'}`}
                >
                  {r.label}
                </a>
              ) : (
                <button
                  key={r.kind + i}
                  type="button"
                  className={`nx-btn nx-btn--sm ${r.primary ? 'nx-btn--primary' : 'nx-btn--ghost'}`}
                  onClick={() => void publish()}
                >
                  {r.label}
                </button>
              ),
            )}
          </div>
        </div>
      ) : null}

      {result ? (
        <section className="nx-card nx-card--pad nx-stack">
          <div className="nx-row justify-between">
            <p className="nx-eyebrow">Live now</p>
            <span className="nx-badge nx-badge--good nx-badge--dot">Live</span>
          </div>
          <a
            href={result.url}
            target="_blank"
            rel="noreferrer noopener"
            className="nx-mono break-all text-sm"
            style={{ color: 'var(--color-accent-600)' }}
          >
            {result.url}
          </a>
          <p className="nx-help">
            Served by {result.target === 'vercel' ? 'Vercel' : 'the Nexora Entity platform hosting tier'}. Your custom
            domain can be connected at any time; the platform generates and verifies the records for you.
          </p>
          {result.validation.checks.length > 0 ? (
            <details>
              <summary className="cursor-pointer text-sm font-medium text-ink-600">
                Final validation ({result.validation.checks.filter((c) => c.ok).length}/{result.validation.checks.length}{' '}
                passed)
              </summary>
              <ul className="nx-stack-sm mt-2" style={{ listStyle: 'none', padding: 0, margin: 0 }}>
                {result.validation.checks.map((c) => (
                  <li key={c.name} className="nx-row justify-between text-xs">
                    <span className="text-ink-600">{c.name}</span>
                    <span className={`nx-badge ${c.ok ? 'nx-badge--good' : 'nx-badge--stop'}`}>{c.ok ? 'pass' : 'fail'}</span>
                  </li>
                ))}
              </ul>
            </details>
          ) : null}
        </section>
      ) : null}

      <p className="nx-help nx-mono">slug: {slug}</p>
    </div>
  );
}