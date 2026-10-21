'use client';

import { useState } from 'react';
import type { ActionableErrorShape } from '@nexora/core';

interface Item {
  id: string;
  kind: string;
  title: string;
  detail: string | null;
  proposed: Record<string, unknown>;
  stage_key: string | null;
  blocking: boolean;
  status: string;
  conflict_id: string | null;
}

interface Props {
  entityId: string;
  initialItems: Item[];
}

const KIND_LABEL: Record<string, string> = {
  conflict: 'Contradiction',
  ambiguity: 'Possible ambiguity',
  identity_verdict: 'Is this profile yours?',
  discovered_fact: 'New information discovered',
  discovered_relationship: 'Possible relationship found',
  change_detected: 'Change detected',
  portfolio_discovery: 'From your portfolio',
  source_limit: 'Could not read a source',
};

/**
 * The review queue. Only genuinely necessary decisions appear here, and nothing discovered is
 * treated as fact until the person accepts it.
 */
export default function ReviewQueue({ entityId, initialItems }: Props) {
  const [items, setItems] = useState<Item[]>(initialItems);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<ActionableErrorShape | null>(null);

  async function decide(id: string, decision: 'accepted' | 'rejected') {
    setBusyId(id);
    setError(null);
    try {
      const res = await fetch('/api/review', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ entityId, reviewItemId: id, decision }),
      });
      const body = (await res.json()) as { ok: boolean; error?: ActionableErrorShape; data?: { item: Item } };
      if (!body.ok) {
        setError(body.error ?? null);
        return;
      }
      setItems((prev) =>
        prev.map((i) => (i.id === id ? { ...i, status: body.data?.item.status ?? decision } : i)),
      );
    } catch {
      setError({
        code: 'network',
        domain: 'system',
        message: 'That decision could not be saved. Nothing else changed — try again.',
        retryable: true,
        remediation: [{ kind: 'retry', label: 'Try again', primary: true }],
        preservesUserProgress: true,
        severity: 'warning',
        status: 502,
        occurredAt: new Date().toISOString(),
      });
    } finally {
      setBusyId(null);
    }
  }

  const pending = items.filter((i) => i.status === 'pending');
  const decided = items.filter((i) => i.status !== 'pending');

  if (error) {
    return (
      <div className="nx-notice nx-notice--stop" role="alert">
        <p className="font-semibold">{error.message}</p>
        <button type="button" className="nx-btn nx-btn--ghost nx-btn--sm mt-2" onClick={() => window.location.reload()}>
          Reload
        </button>
      </div>
    );
  }

  if (pending.length === 0) {
    return (
      <div className="nx-notice nx-notice--good">
        <p className="font-semibold">Nothing needs your decision right now.</p>
        <p className="mt-1 text-xs">
          Nexora Entity will only interrupt you when your decision is genuinely required. It keeps checking your sources in
          the background and will surface anything that changes.
        </p>
      </div>
    );
  }

  return (
    <div className="nx-stack nx-stack--snug">
      {pending.map((item) => (
        <article className="nx-card nx-card--pad nx-stack nx-stack--xs" key={item.id}>
          <div className="nx-row justify-between">
            <div className="nx-row">
              <span className="nx-badge nx-badge--accent">{KIND_LABEL[item.kind] ?? item.kind}</span>
              {item.blocking ? <span className="nx-badge nx-badge--stop">Blocking</span> : null}
              {item.stage_key ? <span className="nx-badge">{item.stage_key.split('_')[0]}</span> : null}
            </div>
          </div>
          <h2 className="text-base font-semibold text-ink-900">{item.title}</h2>
          {item.detail ? (
            <p className="whitespace-pre-wrap text-sm leading-relaxed text-ink-600">{item.detail}</p>
          ) : null}
          {Array.isArray((item.proposed['claimIds'] as unknown) ?? null) ? (
            <p className="nx-help">Two or more recorded facts disagree. Confirming one makes it authoritative in Nexora Entity; the other is kept with its provenance.</p>
          ) : null}
          <div className="nx-row">
            <button
              type="button"
              className="nx-btn nx-btn--primary nx-btn--sm"
              disabled={busyId === item.id}
              onClick={() => void decide(item.id, 'accepted')}
            >
              {busyId === item.id ? 'Saving…' : 'Accept — this is correct'}
            </button>
            <button
              type="button"
              className="nx-btn nx-btn--ghost nx-btn--sm"
              disabled={busyId === item.id}
              onClick={() => void decide(item.id, 'rejected')}
            >
              Reject
            </button>
          </div>
        </article>
      ))}

      {decided.length > 0 ? (
        <details className="nx-card nx-card--pad">
          <summary className="cursor-pointer text-sm font-medium text-ink-600">
            {decided.length} decision{decided.length === 1 ? '' : 's'} already made
          </summary>
          <ul className="nx-stack-sm nx-list mt-3">
            {decided.map((i) => (
              <li key={i.id} className="nx-row justify-between border-b border-ink-50 py-1.5 text-xs">
                <span className="min-w-0 flex-1 truncate text-ink-600">{i.title}</span>
                <span className={`nx-badge ${i.status === 'accepted' ? 'nx-badge--good' : ''}`}>{i.status}</span>
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </div>
  );
}