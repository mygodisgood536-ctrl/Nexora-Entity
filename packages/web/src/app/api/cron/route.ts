import { NextResponse } from 'next/server';
import { config } from '@nexora/core/config';
import { maintainPublishedEntities, platformStatus, runDueJobs } from '@nexora/deploy';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

/**
 * Scheduled maintenance.
 *
 * Re-checks published entities on a schedule so a source that dies or changes is noticed
 * without the person doing anything. The endpoint is reachable only with the cron secret: it
 * triggers real network work and database writes, so an unauthenticated caller must not be able
 * to make the platform fetch arbitrary work.
 *
 * GET  /api/cron           run due jobs, then schedule the next round
 * GET  /api/cron?status=1  report platform health without doing any work
 */
export async function GET(request: Request) {
  const secret = new URL(request.url).searchParams.get('secret') ?? '';
  if (secret !== config().cronSecret) {
    // Deliberately vague: a wrong secret and a missing one must be indistinguishable.
    return NextResponse.json({ ok: false, error: { message: 'Not permitted.' } }, { status: 404 });
  }

  if (new URL(request.url).searchParams.get('status') === '1') {
    return NextResponse.json({ ok: true, data: await platformStatus() });
  }

  try {
    const jobs = await runDueJobs(10);
    const maintenance = await maintainPublishedEntities();
    return NextResponse.json({ ok: true, data: { jobs, maintenance } });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: { message: err instanceof Error ? err.message : String(err) } },
      { status: 500 },
    );
  }
}