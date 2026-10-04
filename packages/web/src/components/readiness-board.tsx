'use client';

import { useState } from 'react';
import Link from 'next/link';
import type { ActionableErrorShape } from '@nexora/core';

interface Check {
  id: string;
  label: string;
  outcome: 'pass' | 'warn' | 'fail' | 'skipped';
  weight: number;
  detail: string;
  stageKey: string | null;
  blocking: boolean;
  sourceRefs: { id: string; label: string; url?: string | null }[];
}

interface Issue {
  code: string;
  title: string;
  detail: string;
  where: { sourceId?: string | null; sourceUrl?: string | null; stageKey?: string | null };
  action: string;
  actionHref?: string;
}

interface Report {
  kind: string;
  status: string;
  score: number;
  label: string;
  summary: string;
  checks: Check[];
  blockingIssues: Issue[];
  warnings: { code: string; title: string; detail: string }[];
  secondPassAnswers?: { question: string; answer: string; pass: boolean; detail: string }[];
  completeness: {
    coverage: number;
    narrative: string;
    materialGaps: { id: string; what: string; why: string; href: string; stageKey: string | null }[];
    optionalGaps: { id: string; what: string; why: string; href: string }[];
    evidenceMinimums: {
      websites: { required: number; qualifying: number; met: boolean };
      pressReleases: { required: number; qualifying: number; met: boolean; independentGroups: number };
      photos: { required: number; qualifying: number; met: boolean };
    };
  };
}

const OUTCOME_LABEL: Record<Check['outcome'], { label: string; cls: string }> = {
  pass: { label: 'Pass', cls: 'nx-badge--good' },
  warn: { label: 'Needs attention', cls: 'nx-badge--warn' },
  fail: { label: 'Not met', cls: 'nx-badge--stop' },
  skipped: { label: 'Skipped', cls: '' },
};

export default function ReadinessBoard({ report, entityId }: { report: Report; entityId: string }) {
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<ActionableErrorShape | null>(null);
  const ready = report.status === 'ready';
  const answered = report.secondPassAnswers ?? [];

  async function reanalyse() {
    setRunning(true);
    setError(null);
    try {
      const res = await fetch(`/api/readiness/run?entity=${entityId}`, { method: 'POST' });
      const body = (await res.json()) as { ok: boolean; error?: ActionableErrorShape };
      if (!body.ok) {
        setError(body.error ?? null);
        return;
      }
      window.location.reload();
    } catch {
      setError({
        code: 'network',
        domain: 'system',
        message: 'The re-check could not be started. Your information is unchanged.',
        retryable: true,
        remediation: [{ kind: 'retry', label: 'Try again', primary: true }],
        preservesUserProgress: true,
        severity: 'warning',
        status: 502,
        occurredAt: new Date().toISOString(),
      });
    } finally {
      setRunning(false);
    }
  }

  return (
    <div className="nx-stack" style={{ gap: '1.25rem' }}>
      <section className="nx-card nx-card--pad nx-stack">
        <div className="nx-row justify-between">
          <div>
            <p className="nx-eyebrow">Result</p>
            <p className="nx-title" style={{ fontSize: '1.6rem', marginTop: '0.25rem' }}>
              {report.label}
            </p>
          </div>
          <div className="nx-row">
            <span className={`nx-badge ${ready ? 'nx-badge--good' : 'nx-badge--stop'} nx-badge--dot`}>
              {ready ? 'Ready to publish' : 'Publication blocked'}
            </span>
            <button type="button" className="nx-btn nx-btn--ghost nx-btn--sm" onClick={() => void reanalyse()} disabled={running}>
              {running ? 'Re-checking sources…' : 'Re-check sources'}
            </button>
          </div>
        </div>
        <div className="nx-track" aria-hidden="true">
          <div
            className={`nx-track__fill ${ready ? 'nx-track__fill--good' : report.score > 60 ? '' : 'nx-track__fill--warn'}`}
            style={{ width: `${Math.max(2, Math.min(100, report.score))}%` }}
          />
        </div>
        <p className="text-sm leading-relaxed text-ink-600">{report.summary}</p>
        {error ? (
          <div className="nx-notice nx-notice--stop" role="alert">
            <p className="font-semibold">{error.message}</p>
            {error.detail ? <p className="mt-1 text-xs">{error.detail}</p> : null}
          </div>
        ) : null}
        {ready ? (
          <div className="nx-row">
            <Link href={`/app/publish?entity=${entityId}`} className="nx-btn nx-btn--accent">
              Publish the Entity Website
            </Link>
          </div>
        ) : (
          <div className="nx-notice nx-notice--stop">
            <p className="font-semibold">
              {report.blockingIssues.length} blocking issue{report.blockingIssues.length === 1 ? '' : 's'} must be
              resolved before this entity can be published.
            </p>
            <p className="mt-1 text-xs">
              Nexora Entity will not publish a blocked entity. Fix what is listed, then the complete whole-entity review
              runs again automatically.
            </p>
          </div>
        )}
      </section>

      {report.blockingIssues.length > 0 ? (
        <section className="nx-stack" style={{ gap: '0.6rem' }}>
          <p className="nx-eyebrow">What is blocking, and where it came from</p>
          {report.blockingIssues.map((issue, i) => (
            <article className="nx-card nx-card--pad nx-stack" key={`${issue.code}-${i}`} style={{ gap: '0.5rem' }}>
              <div className="nx-row">
                <span className="nx-badge nx-badge--stop">Blocking</span>
                {issue.where.stageKey ? <span className="nx-badge">stage {issue.where.stageKey.split('_')[0]}</span> : null}
                {issue.where.sourceUrl ? (
                  <a href={issue.where.sourceUrl} target="_blank" rel="noreferrer noopener" className="nx-mono truncate text-xs">
                    {issue.where.sourceUrl}
                  </a>
                ) : null}
              </div>
              <h3 className="text-base font-semibold text-ink-900">{issue.title}</h3>
              <p className="text-sm leading-relaxed text-ink-600">{issue.detail}</p>
              <div className="nx-row">
                {issue.actionHref ? (
                  <Link href={issue.actionHref} className="nx-btn nx-btn--primary nx-btn--sm">
                    {issue.action}
                  </Link>
                ) : null}
                {issue.where.sourceUrl ? (
                  <a href={issue.where.sourceUrl} target="_blank" rel="noreferrer noopener" className="nx-btn nx-btn--ghost nx-btn--sm">
                    Open the source
                  </a>
                ) : null}
              </div>
            </article>
          ))}
        </section>
      ) : null}

      <section className="nx-card nx-card--pad nx-stack">
        <p className="nx-eyebrow">Evidence minimums</p>
        <div className="grid gap-3 sm:grid-cols-3">
          <MinCard label="Websites" current={report.completeness.evidenceMinimums.websites.qualifying} required={report.completeness.evidenceMinimums.websites.required} met={report.completeness.evidenceMinimums.websites.met} note="Live and genuinely about this person" />
          <MinCard
            label="Press releases"
            current={report.completeness.evidenceMinimums.pressReleases.qualifying}
            required={report.completeness.evidenceMinimums.pressReleases.required}
            met={report.completeness.evidenceMinimums.pressReleases.met}
            note={`${report.completeness.evidenceMinimums.pressReleases.independentGroups} independent source group(s)`}
          />
          <MinCard label="Photos" current={report.completeness.evidenceMinimums.photos.qualifying} required={report.completeness.evidenceMinimums.photos.required} met={report.completeness.evidenceMinimums.photos.met} note="Valid, large enough, not duplicates" />
        </div>
      </section>

      <section className="nx-card nx-card--pad nx-stack">
        <p className="nx-eyebrow">Does Nexora Entity understand this person?</p>
        <p className="text-sm leading-relaxed text-ink-600">{report.completeness.narrative}</p>
        {report.completeness.materialGaps.length > 0 ? (
          <div className="nx-stack-sm">
            <p className="nx-help">Material gaps — the platform needs these to publish:</p>
            {report.completeness.materialGaps.map((gap) => (
              <Link key={gap.id} href={gap.href} className="nx-card nx-card--pad block no-underline transition hover:border-ink-300" style={{ color: 'inherit' }}>
                <div className="nx-row justify-between">
                  <span className="text-sm font-medium text-ink-800">{gap.what}</span>
                  <span className="nx-badge">{gap.stageKey?.split('_')[0] ?? 'general'}</span>
                </div>
                <p className="nx-help" style={{ marginTop: '0.25rem' }}>
                  {gap.why}
                </p>
              </Link>
            ))}
          </div>
        ) : null}
      </section>

      <section className="nx-card nx-card--pad nx-stack">
        <p className="nx-eyebrow">Every check</p>
        <div className="nx-table__scroll">
          <table className="nx-table">
            <thead>
              <tr>
                <th>Check</th>
                <th>Result</th>
                <th>Detail</th>
              </tr>
            </thead>
            <tbody>
              {report.checks.map((c) => {
                const meta = OUTCOME_LABEL[c.outcome];
                return (
                  <tr key={c.id}>
                    <td className="font-medium text-ink-800">{c.label}</td>
                    <td>
                      <span className={`nx-badge ${meta.cls}`}>{meta.label}</span>
                    </td>
                    <td className="max-w-[28rem] text-xs">{c.detail}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {report.warnings.length > 0 ? (
          <details>
            <summary className="cursor-pointer text-sm font-medium text-ink-600">
              {report.warnings.length} thing{report.warnings.length === 1 ? '' : 's'} worth knowing
            </summary>
            <ul className="nx-stack-sm mt-2" style={{ listStyle: 'none', padding: 0, margin: 0 }}>
              {report.warnings.map((w) => (
                <li key={w.code} className="text-xs leading-relaxed text-ink-500">
                  <span className="font-medium text-ink-700">{w.title}.</span> {w.detail}
                </li>
              ))}
            </ul>
          </details>
        ) : null}
      </section>

      <section className="nx-card nx-card--pad nx-stack">
        <p className="nx-eyebrow">Complete whole-entity review</p>
        <p className="nx-help">
          This pass re-examined the entire entity from the beginning — all of your information, all collected external
          information, every relationship, source, conflict and requirement — rather than only the field you corrected.
        </p>
        <ol className="nx-stack-sm" style={{ listStyle: 'none', padding: 0, margin: 0 }}>
          {answered.map((a, i) => (
            <li key={a.question} className="border-b border-ink-50 py-2 last:border-b-0">
              <div className="nx-row justify-between">
                <span className="text-sm font-medium text-ink-800">{a.question}</span>
                <span className={`nx-badge ${a.pass ? 'nx-badge--good' : 'nx-badge--warn'}`}>{a.answer}</span>
              </div>
              <p className="nx-help" style={{ marginTop: '0.25rem' }}>
                {a.detail}
              </p>
              <span className="sr-only">{i}</span>
            </li>
          ))}
        </ol>
      </section>
    </div>
  );
}

function MinCard({
  label,
  current,
  required,
  met,
  note,
}: {
  label: string;
  current: number;
  required: number;
  met: boolean;
  note: string;
}) {
  return (
    <div className="nx-card nx-card--pad">
      <div className="nx-row justify-between">
        <span className="text-sm font-medium text-ink-700">{label}</span>
        <span className={`nx-badge ${met ? 'nx-badge--good' : 'nx-badge--warn'}`}>
          {current}/{required}
        </span>
      </div>
      <div className="nx-track" style={{ marginTop: '0.5rem' }} aria-hidden="true">
        <div
          className={`nx-track__fill ${met ? 'nx-track__fill--good' : ''}`}
          style={{ width: `${Math.max(3, Math.min(100, (current / required) * 100))}%` }}
        />
      </div>
      <p className="nx-help" style={{ marginTop: '0.4rem' }}>
        {note}
      </p>
    </div>
  );
}