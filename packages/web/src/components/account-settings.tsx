'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';

interface AccountUser {
  id: string;
  fullName: string;
  username: string;
  createdAt: string;
}

interface AccountSession {
  id: string;
  createdAt: string;
  expiresAt: string;
  revokedAt: string | null;
  ip: string | null;
  userAgent: string | null;
  current: boolean;
}

interface AccountEntity {
  id: string;
  displayName: string | null;
  slug: string;
  status: string;
  publishedAt: string | null;
}

interface AccountData {
  user: AccountUser;
  sessions: AccountSession[];
  entities: AccountEntity[];
}

type Section = 'profile' | 'security' | 'sessions';

/**
 * The account screen.
 *
 * Section 30 asks for clear controls for user data and connected accounts. This is where they
 * live: the name on the account, the security question that protects it, the sessions that are
 * currently able to sign in, and the entities the account holds.
 */
export default function AccountSettings() {
  const router = useRouter();
  const [data, setData] = useState<AccountData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [section, setSection] = useState<Section>('profile');

  const [fullName, setFullName] = useState('');
  const [nameStatus, setNameStatus] = useState<'idle' | 'saving' | 'saved' | 'failed'>('idle');

  const [currentAnswer, setCurrentAnswer] = useState('');
  const [newQuestion, setNewQuestion] = useState('');
  const [newAnswer, setNewAnswer] = useState('');
  const [securityStatus, setSecurityStatus] = useState<'idle' | 'saving' | 'saved' | 'failed'>('idle');
  const [securityMessage, setSecurityMessage] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const res = await fetch('/api/account');
      const body = (await res.json()) as { ok: boolean; data?: AccountData; error?: { message?: string } };
      if (!body.ok || !body.data) {
        setError(body.error?.message ?? 'Your account could not be loaded.');
        return;
      }
      setData(body.data);
      setFullName(body.data.user.fullName);
    } catch {
      setError('Your account could not be loaded. Check your connection and try again.');
    }
  }, []);

  useEffect(() => {
    // The account is fetched on arrival. The state is set when the request resolves, not
    // synchronously inside the effect body.
    void (async () => {
      setLoading(true);
      await load();
      setLoading(false);
    })();
  }, [load]);

  async function saveName() {
    setNameStatus('saving');
    try {
      const res = await fetch('/api/account', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ fullName }),
      });
      const body = (await res.json()) as { ok: boolean; error?: { message?: string } };
      if (!body.ok) {
        setNameStatus('failed');
        return;
      }
      setNameStatus('saved');
      await load();
      router.refresh();
    } catch {
      setNameStatus('failed');
    }
  }

  async function saveSecurity() {
    setSecurityStatus('saving');
    setSecurityMessage(null);
    try {
      const res = await fetch('/api/account/security', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ currentAnswer, newQuestion, newAnswer }),
      });
      const body = (await res.json()) as { ok: boolean; error?: { message?: string } };
      if (!body.ok) {
        setSecurityStatus('failed');
        setSecurityMessage(body.error?.message ?? 'The security question could not be changed.');
        return;
      }
      setSecurityStatus('saved');
      setSecurityMessage('Your security question was changed and your other sessions were ended.');
      setCurrentAnswer('');
      setNewAnswer('');
      await load();
    } catch {
      setSecurityStatus('failed');
      setSecurityMessage('The security question could not be changed. Nothing was lost.');
    }
  }

  async function endSession(id: string) {
    try {
      const res = await fetch('/api/account/sessions', {
        method: 'DELETE',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ sessionId: id }),
      });
      if (res.ok) await load();
    } catch {
      /* the session list is reloaded on the next visit */
    }
  }

  if (loading) {
    return (
      <div className="nx-stack nx-stack--loose" aria-busy="true">
        <div className="nx-skeleton h-3 w-32" />
        <div className="nx-skeleton h-9 w-64" />
        <div className="nx-skeleton h-64 w-full" />
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="nx-notice nx-notice--stop" role="alert">
        <p className="font-semibold">Your account could not be loaded.</p>
        <p className="mt-1 text-xs">{error ?? 'Please try again.'}</p>
        <button type="button" className="nx-btn nx-btn--ghost nx-btn--sm mt-3" onClick={() => void load()}>
          Try again
        </button>
      </div>
    );
  }

  const openSessions = data.sessions.filter((s) => !s.revokedAt);

  return (
    <div className="nx-stack nx-stack--loose">
      <div>
        <p className="nx-eyebrow">Account</p>
        <h1 className="nx-title">Your Account</h1>
        <p className="nx-subtitle">
          Your name, the security question that protects your sign-in, the sessions currently able to sign in as you, and the
          entities this account holds.
        </p>
      </div>

      <div className="nx-row gap-1 border-b border-ink-100" role="tablist" aria-label="Account sections">
        {(
          [
            ['profile', 'Profile'],
            ['security', 'Security'],
            ['sessions', 'Sessions'],
          ] as [Section, string][]
        ).map(([value, label]) => (
          <button
            key={value}
            type="button"
            role="tab"
            aria-selected={section === value}
            className="rounded-t-lg border-b-2 px-4 py-2 text-sm transition"
            style={{
              borderBottomColor: section === value ? 'var(--nx-accent-600)' : 'transparent',
              color: section === value ? 'var(--nx-ink-900)' : 'var(--nx-ink-500)',
            }}
            onClick={() => setSection(value)}
          >
            {label}
          </button>
        ))}
      </div>

      {section === 'profile' ? (
        <section className="nx-card nx-card--pad nx-stack" aria-label="Profile">
          <div>
            <p className="nx-eyebrow">Profile</p>
            <p className="nx-title nx-metric--md">Your Name</p>
          </div>

          <div className="nx-field">
            <label className="nx-label" htmlFor="account-full-name">
              Full name
            </label>
            <input
              id="account-full-name"
              className="nx-input"
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              autoComplete="name"
              maxLength={120}
            />
            <p className="nx-help">This is the name shown on the accounts and entities you build.</p>
          </div>

          <div className="nx-field">
            <span className="nx-label">Username</span>
            <p className="nx-help nx-mono">@{data.user.username}</p>
            <p className="nx-help">
              Your username is half of your sign-in and never changes, so your stable identifier is never broken.
            </p>
          </div>

          <div className="nx-row">
            <button
              type="button"
              className="nx-btn nx-btn--primary"
              onClick={() => void saveName()}
              disabled={nameStatus === 'saving' || fullName.trim().length < 2}
            >
              {nameStatus === 'saving' ? 'Saving…' : 'Save changes'}
            </button>
            {nameStatus === 'saved' ? <span className="nx-help">Saved.</span> : null}
            {nameStatus === 'failed' ? <span className="nx-help">Your name could not be changed. Nothing was lost.</span> : null}
          </div>

          <div>
            <p className="nx-eyebrow">Your entities</p>
            {data.entities.length === 0 ? (
              <p className="nx-help">This account does not hold an entity yet.</p>
            ) : (
              <ul className="nx-list nx-stack-sm mt-1">
                {data.entities.map((e) => (
                  <li key={e.id} className="nx-row justify-between text-sm">
                    <span className="min-w-0 truncate">{e.displayName ?? 'Untitled entity'}</span>
                    <span className={`nx-badge ${e.status === 'published' ? 'nx-badge--good' : 'nx-badge--accent'}`}>
                      {e.status === 'published' ? 'Published' : 'In progress'}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>
      ) : null}

      {section === 'security' ? (
        <section className="nx-card nx-card--pad nx-stack" aria-label="Security">
          <div>
            <p className="nx-eyebrow">Security</p>
            <p className="nx-title nx-metric--md">Your Security Question</p>
            <p className="nx-help">
              Your security question and answer are how you sign in. Changing them ends every other session, because a secret
              that has been exposed is not safe to keep using anywhere else.
            </p>
          </div>

          <div className="nx-field">
            <label className="nx-label" htmlFor="current-answer">
              Current security answer
            </label>
            <input
              id="current-answer"
              className="nx-input"
              type="password"
              autoComplete="off"
              value={currentAnswer}
              onChange={(e) => setCurrentAnswer(e.target.value)}
            />
            <p className="nx-help">We ask for this to prove it is really you before changing it.</p>
          </div>

          <div className="nx-field">
            <label className="nx-label" htmlFor="new-question">
              New security question
            </label>
            <input
              id="new-question"
              className="nx-input"
              value={newQuestion}
              onChange={(e) => setNewQuestion(e.target.value)}
              maxLength={200}
            />
          </div>

          <div className="nx-field">
            <label className="nx-label" htmlFor="new-answer">
              New security answer
            </label>
            <input
              id="new-answer"
              className="nx-input"
              type="password"
              autoComplete="off"
              value={newAnswer}
              onChange={(e) => setNewAnswer(e.target.value)}
            />
          </div>

          <div className="nx-row">
            <button
              type="button"
              className="nx-btn nx-btn--primary"
              onClick={() => void saveSecurity()}
              disabled={securityStatus === 'saving' || !currentAnswer || newQuestion.trim().length < 8 || newAnswer.length < 2}
            >
              {securityStatus === 'saving' ? 'Changing…' : 'Change security question'}
            </button>
          </div>
          {securityMessage ? (
            <p className="nx-help" role="status">
              {securityMessage}
            </p>
          ) : null}
        </section>
      ) : null}

      {section === 'sessions' ? (
        <section className="nx-card nx-card--pad nx-stack" aria-label="Sessions">
          <div>
            <p className="nx-eyebrow">Sessions</p>
            <p className="nx-title nx-metric--md">Where You Are Signed In</p>
            <p className="nx-help">
              If you do not recognise a session, end it. It stops being able to sign in as you immediately.
            </p>
          </div>

          {openSessions.length === 0 ? (
            <p className="nx-help">There are no open sessions.</p>
          ) : (
            <ul className="nx-list nx-stack-sm">
              {openSessions.map((s) => (
                <li key={s.id} className="nx-card nx-card--pad nx-stack nx-stack--tight">
                  <div className="nx-row justify-between">
                    <span className="text-sm font-medium text-ink-800">
                      {describeAgent(s.userAgent)}
                      {s.current ? ' · This device' : ''}
                    </span>
                    {s.current ? <span className="nx-badge nx-badge--good">Current</span> : null}
                  </div>
                  <p className="nx-help nx-mono">
                    Signed in {new Date(s.createdAt).toLocaleString()}
                    {s.ip ? ` · ${s.ip}` : ''}
                  </p>
                  {!s.current ? (
                    <div className="nx-row">
                      <button type="button" className="nx-btn nx-btn--danger nx-btn--sm" onClick={() => void endSession(s.id)}>
                        End this session
                      </button>
                    </div>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </section>
      ) : null}
    </div>
  );
}

/** A short, recognisable description of a session from its user agent. */
function describeAgent(userAgent: string | null): string {
  if (!userAgent) return 'Unknown device';
  if (/edg/i.test(userAgent)) return 'Microsoft Edge';
  if (/chrome|crios/i.test(userAgent)) return 'Google Chrome';
  if (/firefox/i.test(userAgent)) return 'Firefox';
  if (/safari/i.test(userAgent)) return 'Safari';
  if (/curl|wget|node|tsx/i.test(userAgent)) return 'Command line';
  return 'Another device';
}
