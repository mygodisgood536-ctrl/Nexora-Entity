import Link from 'next/link';
import { EVIDENCE_MINIMUMS_NOTICE, READINESS_DISCLAIMER } from '@nexora/core';
import {
  countCorrectionsSince,
  createReadinessRun,
  finishReadinessRun,
  findEntityForUser,
  latestCompletedRun,
  listReadinessRuns,
} from '@nexora/db';
import { buildReadinessReport } from '@nexora/engine';
import { requireUser } from '@/lib/server';
import ReadinessBoard from '@/components/readiness-board';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

export default async function ReadinessPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await requireUser('/app/readiness');
  const query = await searchParams;
  const entityId = Array.isArray(query['entity']) ? query['entity'][0] : (query['entity'] as string | undefined);
  if (!entityId) {
    return (
      <main id="main" className="nx-shell py-10">
        <p className="nx-notice nx-notice--warn">Choose an entity from the overview first.</p>
      </main>
    );
  }
  const entity = await findEntityForUser(entityId, user.id);
  if (!entity) {
    return (
      <main id="main" className="nx-shell py-10">
        <p className="nx-notice nx-notice--stop">That entity is not yours.</p>
      </main>
    );
  }

  // The complete whole-entity second pass runs here, and its result is what is shown. Reading
  // the previous run first is what lets the report say how much changed since it.
  const previous = await latestCompletedRun(entity.id);
  const report = await buildReadinessReport(entity.id, 'second_pass');

  // Persist this run so there is a durable audit trail of every review performed.
  const run = await createReadinessRun({
    entityId: entity.id,
    kind: 'second_pass',
    parentRunId: previous?.id ?? null,
    correctionsSinceParent: await countCorrectionsSince(
      entity.id,
      previous ? new Date(previous.finished_at ?? previous.started_at).toISOString() : null,
    ),
  });
  await finishReadinessRun({
    runId: run.id,
    status: report.status,
    score: report.score,
    checks: report.checks,
    blockingIssues: report.blockingIssues,
    warnings: report.warnings,
    secondPassAnswers: report.secondPassAnswers,
    summary: report.summary,
  });

  // Read after the run is written, so the history table includes the review just performed.
  const history = await listReadinessRuns(entity.id, 8);

  const ready = report.status === 'ready';

  return (
    <main id="main" className="nx-shell py-8">
      <div className="nx-stack" style={{ gap: '1.25rem' }}>
        <div>
          <p className="nx-eyebrow">Entity Readiness</p>
          <h1 className="nx-title" style={{ marginTop: '0.35rem' }}>
            {entity.display_name ?? 'This entity'}
          </h1>
          <p className="nx-help nx-mono" style={{ marginTop: '0.25rem' }}>
            {entity.entity_uid}
          </p>
        </div>

        <ReadinessBoard report={report as never} entityId={entity.id} />

        <div className="nx-notice nx-notice--info">
          <p className="text-xs leading-relaxed">{READINESS_DISCLAIMER}</p>
        </div>
        <p className="nx-help">{EVIDENCE_MINIMUMS_NOTICE}</p>

        <div className="nx-row">
          <Link href={`/app/review?entity=${entity.id}`} className="nx-btn nx-btn--ghost nx-btn--sm">
            Review queue
          </Link>
          <Link href={`/app/publish?entity=${entity.id}`} className="nx-btn nx-btn--ghost nx-btn--sm">
            Publish
          </Link>
          <Link href="/app" className="nx-btn nx-btn--quiet nx-btn--sm">
            Overview
          </Link>
        </div>

        {history.length > 0 ? (
          <section className="nx-card nx-card--pad nx-stack">
            <p className="nx-eyebrow">Review history</p>
            <div className="nx-table__scroll">
              <table className="nx-table">
                <thead>
                  <tr>
                    <th>When</th>
                    <th>Type</th>
                    <th>Result</th>
                    <th>Score</th>
                    <th>Blocking</th>
                  </tr>
                </thead>
                <tbody>
                  {history.map((h) => (
                    <tr key={h.id}>
                      <td>{new Date(h.started_at).toLocaleString()}</td>
                      <td>{h.kind === 'second_pass' ? 'Complete review' : 'Standard'}</td>
                      <td>
                        <span className={`nx-badge ${h.status === 'ready' ? 'nx-badge--good' : 'nx-badge--warn'}`}>
                          {h.status}
                        </span>
                      </td>
                      <td>{Math.round(Number(h.score))}%</td>
                      <td>{h.blocking_issues.length}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="nx-help">
              Every review is kept. A correction by you does not clear the gate on its own: the complete whole-entity
              review runs again from the beginning.
            </p>
          </section>
        ) : null}
        <section className="nx-card nx-card--pad">
          <p className="nx-eyebrow">Latest complete review</p>
          <p className="nx-lede" style={{ marginTop: '0.35rem' }}>
            {ready
              ? 'Every blocking check passed. Publication is permitted by the Nexora Entity Readiness Standard.'
              : `${report.blockingIssues.length} blocking issue${report.blockingIssues.length === 1 ? '' : 's'} must be resolved before publication is permitted.`}
          </p>
          {ready ? (
            <Link href={`/app/publish?entity=${entity.id}`} className="nx-btn nx-btn--accent" style={{ marginTop: '0.75rem' }}>
              Continue to publish
            </Link>
          ) : (
            <Link href={`/app/review?entity=${entity.id}`} className="nx-btn nx-btn--primary" style={{ marginTop: '0.75rem' }}>
              Resolve blocking issues
            </Link>
          )}
        </section>
      </div>
    </main>
  );
}