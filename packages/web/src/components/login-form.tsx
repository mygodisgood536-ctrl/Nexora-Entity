'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { PRODUCT_NAME } from '@nexora/core';
import type { ActionableErrorShape } from '@nexora/core';
import ThemeToggle from '@/components/theme-toggle';

/**
 * Constrain the post-login destination to a path inside this application.
 *
 * `next` arrives from the URL, so it is attacker-controllable. Without this check,
 * `/login?next=https://evil.example` would send a freshly authenticated person straight offsite.
 * Protocol-relative (`//host`) and backslash (`/\host`) forms are rejected too, because both are
 * parsed as absolute URLs by the browser.
 */
function safeNext(raw: string | null): string {
  if (!raw) return '/app';
  if (!raw.startsWith('/')) return '/app';
  if (raw.startsWith('//') || raw.startsWith('/\\')) return '/app';
  return raw;
}

interface Props {
  /** Post-login destination, already validated by the server page. */
  next: string | null;
  /** Whether the person arrived here straight after creating an account. */
  justRegistered: boolean;
}

export function LoginForm({ next: requestedNext, justRegistered }: Props) {
  const router = useRouter();
  const [username, setUsername] = useState('');
  const [securityQuestion, setSecurityQuestion] = useState('');
  const [securityAnswer, setSecurityAnswer] = useState('');
  const [error, setError] = useState<ActionableErrorShape | null>(null);
  const [busy, setBusy] = useState(false);
  const next = safeNext(requestedNext);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ username, securityQuestion, securityAnswer }),
      });
      const body = (await res.json()) as { ok: boolean; error?: ActionableErrorShape };
      if (!body.ok) {
        setError(body.error ?? null);
        return;
      }
      router.push(next);
      router.refresh();
    } catch {
      setError({
        code: 'network',
        domain: 'system',
        message: 'Nexora Entity could not reach its own server. Nothing you entered has been lost — try again.',
        retryable: true,
        remediation: [{ kind: 'retry', label: 'Try again', primary: true }],
        preservesUserProgress: true,
        severity: 'blocking',
        status: 502,
        occurredAt: new Date().toISOString(),
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <main id="main" className="flex min-h-screen flex-col">
      <header className="border-b border-ink-100">
        <div className="nx-shell nx-shell--narrow flex items-center justify-between py-4">
          <Link href="/" className="flex items-center gap-2.5 no-underline">
            <span
              aria-hidden="true"
              className="nx-brandmark grid h-8 w-8 place-items-center rounded-lg text-[0.65rem] font-bold"
            >
              NE
            </span>
            <span className="font-display text-[1.05rem] tracking-tight text-ink-900">{PRODUCT_NAME}</span>
          </Link>
          <div className="flex items-center gap-2">
            <ThemeToggle />
            <Link href="/signup" className="nx-btn nx-btn--ghost nx-btn--sm">
              Create an account
            </Link>
          </div>
        </div>
      </header>

      <div className="nx-shell nx-shell--narrow flex flex-1 items-start justify-center py-12 md:py-20">
        <div className="w-full max-w-md">
          <p className="nx-eyebrow">Step 2 of 2</p>
          <h1 className="nx-title">Sign In</h1>
          <p className="nx-subtitle mb-6">
            Enter your username, the exact security question you chose when you signed up, and your security answer.
          </p>

          {justRegistered ? (
            <div className="nx-notice nx-notice--good mb-4" role="status">
              Your account is ready. Sign in with the details you just chose.
            </div>
          ) : null}

          {error ? (
            <div className="nx-notice nx-notice--stop mb-4" role="alert">
              <p className="font-semibold">{error.message}</p>
              {error.detail ? <p className="mt-1 text-xs opacity-90">{error.detail}</p> : null}
            </div>
          ) : null}

          {/* method="post": the security answer must never be serialised into the URL. The
              implicit GET method would put it in history, logs and the Referer header if
              JavaScript were unavailable. See spec §30. */}
          <form onSubmit={submit} method="post" className="nx-stack" noValidate>
            <div className="nx-field">
              <label className="nx-label" htmlFor="username">
                Username
              </label>
              <input
                id="username"
                name="username"
                className="nx-input"
                autoComplete="username"
                required
                value={username}
                onChange={(e) => setUsername(e.target.value.toLowerCase())}
              />
            </div>

            <div className="nx-field">
              <label className="nx-label" htmlFor="securityQuestion">
                Security question
              </label>
              <input
                id="securityQuestion"
                className="nx-input"
                required
                placeholder="Exactly as you chose it at sign-up"
                value={securityQuestion}
                onChange={(e) => setSecurityQuestion(e.target.value)}
              />
              <p className="nx-help">
                It must match your saved question. Capitalisation and spacing are ignored.
              </p>
            </div>

            <div className="nx-field">
              <label className="nx-label" htmlFor="securityAnswer">
                Security answer
              </label>
              <input
                id="securityAnswer"
                name="securityAnswer"
                className="nx-input"
                required
                autoComplete="off"
                value={securityAnswer}
                onChange={(e) => setSecurityAnswer(e.target.value)}
              />
            </div>

            <button type="submit" className="nx-btn nx-btn--primary mt-2" disabled={busy}>
              {busy ? 'Signing in…' : 'Sign in'}
            </button>
          </form>

          <p className="nx-help mt-5">
            Repeated failed attempts temporarily lock the account to protect it. Your information is never lost.
          </p>
        </div>
      </div>
    </main>
  );
}