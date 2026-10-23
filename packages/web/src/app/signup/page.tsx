'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { PRODUCT_NAME } from '@nexora/core';
import type { ActionableErrorShape } from '@nexora/core';
import ThemeToggle from '@/components/theme-toggle';

const QUESTIONS = [
  'What is the name of the first product you ever shipped?',
  'What was the name of your first school?',
  'What city were you born in?',
  'What was the name of your first employer?',
  'What is the middle name you go by?',
  'What was your first significant online handle?',
];

export default function SignupForm() {
  const router = useRouter();
  const [fullName, setFullName] = useState('');
  const [username, setUsername] = useState('');
  const [securityQuestion, setSecurityQuestion] = useState('');
  const [customQuestion, setCustomQuestion] = useState('');
  const [securityAnswer, setSecurityAnswer] = useState('');
  const [showQuestionField, setShowQuestionField] = useState(false);
  const [error, setError] = useState<ActionableErrorShape | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const question = showQuestionField ? customQuestion : securityQuestion;
    try {
      const res = await fetch('/api/auth/signup', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          fullName,
          username,
          securityQuestion: question,
          securityAnswer,
        }),
      });
      const body = (await res.json()) as { ok: boolean; error?: ActionableErrorShape; next?: string };
      if (!body.ok) {
        setError(body.error ?? null);
        return;
      }
      // Spec §4: after signup the person must sign in. The server owns this URL so the
      // `next`/`justRegistered` query pair is encoded once, in one place.
      router.push(body.next ?? '/login?justRegistered=1');
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
      {/* Cinematic atmospheric background */}
      <div aria-hidden="true" className="fixed inset-0 -z-10 nx-auth-backdrop" />
      <div aria-hidden="true" className="fixed inset-0 -z-10 nx-auth-gradient" />
      <div aria-hidden="true" className="fixed inset-0 -z-10 nx-auth-grid" />
      <div aria-hidden="true" className="fixed inset-0 -z-10 nx-auth-glow" />

      <header className="border-b border-ink-100/50">
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
            <Link href="/login" className="nx-btn nx-btn--ghost nx-btn--sm">
              I already have an account
            </Link>
          </div>
        </div>
      </header>

      <div className="nx-shell nx-shell--narrow flex-1 py-10 md:py-16">
        <div className="grid gap-8 md:grid-cols-[1fr_0.85fr]">
          <div className="nx-auth-card nx-card nx-card--pad nx-stack">
            <p className="nx-eyebrow">Step 1 of 2</p>
            <h1 className="nx-title">Create Your Account</h1>
            <p className="nx-subtitle mb-6">
              Four fields. No email address, no password, no technical questions. You will sign in with your username,
              your security question and your security answer.
            </p>

            {error ? (
              <div className="nx-notice nx-notice--stop mb-4" role="alert">
                <p className="font-semibold">{error.message}</p>
                {error.detail ? <p className="mt-1 text-xs opacity-90">{error.detail}</p> : null}
              </div>
            ) : null}

            {/* method="post" is a security requirement, not a default: if JavaScript has not
                loaded yet, a form with the implicit GET method would serialise every field
                into the URL — putting the security answer into browser history, proxy and
                server logs, and the Referer header. Spec §30 requires credential protection. */}
            <form onSubmit={submit} method="post" className="nx-stack" noValidate>
              <div className="nx-field">
                <label className="nx-label" htmlFor="fullName">
                  Full name
                </label>
                <input
                  id="fullName"
                  name="fullName"
                  className="nx-input"
                  autoComplete="name"
                  required
                  minLength={2}
                  maxLength={120}
                  placeholder="The name you are publicly known by"
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                />
              </div>

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
                  minLength={3}
                  maxLength={32}
                  placeholder="letters, numbers, dots, hyphens"
                  value={username}
                  onChange={(e) => setUsername(e.target.value.toLowerCase())}
                />
                <p className="nx-help">You will sign in with this. Lowercase letters, numbers, dots, hyphens and underscores.</p>
              </div>

              <div className="nx-field">
                <label className="nx-label" htmlFor="securityQuestion">
                  Security question
                </label>
                {showQuestionField ? (
                  <input
                    id="securityQuestion"
                    className="nx-input"
                    required
                    minLength={8}
                    maxLength={200}
                    placeholder="Write a question only you would answer"
                    value={customQuestion}
                    onChange={(e) => setCustomQuestion(e.target.value)}
                  />
                ) : (
                  <select
                    id="securityQuestion"
                    className="nx-select"
                    required
                    value={securityQuestion}
                    onChange={(e) => setSecurityQuestion(e.target.value)}
                  >
                    <option value="">Choose a question…</option>
                    {QUESTIONS.map((q) => (
                      <option key={q} value={q}>
                        {q}
                      </option>
                    ))}
                  </select>
                )}
                <button
                  type="button"
                  className="nx-btn nx-btn--quiet nx-btn--sm self-start"
                  onClick={() => setShowQuestionField((v) => !v)}
                >
                  {showQuestionField ? 'Choose from the list instead' : 'Write my own question'}
                </button>
                <p className="nx-help">
                  You will be asked for this exact question when signing in, so pick one you will recognise.
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
                  minLength={2}
                  maxLength={200}
                  autoComplete="off"
                  placeholder="Your answer"
                  value={securityAnswer}
                  onChange={(e) => setSecurityAnswer(e.target.value)}
                />
                <p className="nx-help">
                  Stored as a salted scrypt hash, never as plain text. Capitalisation and extra spaces are ignored when you
                  sign in.
                </p>
              </div>

              <button type="submit" className="nx-btn nx-btn--primary mt-2" disabled={busy}>
                {busy ? 'Creating your account…' : 'Create account'}
              </button>
              <p className="nx-help">
                After this you will sign in. Nothing else is required before you can start building your entity.
              </p>
            </form>
          </div>

          <aside className="nx-card nx-card--pad nx-stack self-start">
            <p className="nx-eyebrow">What happens next</p>
            <ol className="nx-stack-sm nx-list">
              {[
                'You sign in with your username, security question and answer.',
                'You create your entity. The AI provider and model panel opens immediately.',
                'You choose a provider and model from what OpenCode actually exposes, and it is tested before being accepted.',
                'You work through the guided stages, skipping anything you want to come back to.',
                'Nexora Entity investigates your sources in the background while you continue.',
              ].map((line, i) => (
                <li key={line} className="nx-row items-start gap-2.5 text-sm leading-relaxed text-ink-600">
                  <span className="nx-rail__letter flex-none">{i + 1}</span>
                  <span>{line}</span>
                </li>
              ))}
            </ol>
            <div className="nx-notice nx-notice--info">
              <p className="text-xs leading-relaxed">
                Nexora Entity never asks you to prove a platform connection to read public information. Where a platform
                does not permit automated reading, that limitation is recorded honestly instead.
              </p>
            </div>
          </aside>
        </div>
      </div>
    </main>
  );
}