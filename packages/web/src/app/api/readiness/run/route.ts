import {
  createReadinessRun,
  findEntityForUser,
  finishReadinessRun,
  latestCompletedRun,
  listReviewItems,
} from '@nexora/db';
import { buildReadinessReport } from '@nexora/engine';
import { requireUser } from '@/lib/server';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;


/**
 * Run the complete whole-entity review on demand.
 *
 * This is the mandatory second pass: it re-examines everything rather than only the last
 * corrected field, and it is what actually permits publication at 100%.
 */
export async function POST(request: Request) {
  const user = await requireUser();
  const url = new URL(request.url);
  const entityId = url.searchParams.get('entity');

  if (!entityId) {
    return Response.json({ ok: false, error: { code: 'user_data_invalid', domain: 'user_data', message: 'entity is required.' } }, { status: 400 });
  }
  const entity = await findEntityForUser(entityId, user.id);
  if (!entity) {
    return Response.json({ ok: false, error: { code: 'auth_forbidden', domain: 'auth', message: 'That entity is not yours.' } }, { status: 403 });
  }

  try {
    const parent = await latestCompletedRun(entityId);
    const pending = await listReviewItems(entityId, true);
    const report = await buildReadinessReport(entityId, 'second_pass');

    const run = await createReadinessRun({
      entityId,
      kind: 'second_pass',
      parentRunId: parent?.id ?? null,
      correctionsSinceParent: pending.length,
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

    return Response.json({
      ok: true,
      data: {
        runId: run.id,
        status: report.status,
        score: report.score,
        label: report.label,
        blocking: report.blockingIssues.length,
      },
    });
  } catch (err) {
    const { toActionableError } = await import('@nexora/core');
    const error = toActionableError(err);
    return Response.json({ ok: false, error }, { status: error.status });
  }
}
