import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { config } from '@nexora/core/config';
import { DeploymentTarget, toActionableError, ReadinessBlockedError, UserDataError } from '@nexora/core';
import { audit, findEntityForUser, latestReadyRun, resolveSession } from '@nexora/db';
import { buildReadinessReport } from '@nexora/engine';
import { chooseTarget, deployEntity, ensurePlatformSubdomain } from '@nexora/deploy';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

/**
 * Deploy the public Entity Website.
 *
 * The gate is enforced here, not in the interface: an entity that has not reached 100% Entity
 * Readiness is refused, whatever the browser believes. The generated site is validated before
 * anything is published, and a deployment is only recorded as live once it actually was.
 */
export async function POST(request: Request) {
  const store = await cookies();
  const user = await resolveSession(store.get(config().sessionCookieName)?.value);
  if (!user) return NextResponse.json({ ok: false, error: { message: 'Sign in first.' } }, { status: 401 });

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: UserDataError.invalid('body', 'Could not read the request.').toJSON() }, { status: 400 });
  }
  const body = payload as { entityId?: unknown; target?: unknown };
  if (typeof body.entityId !== 'string') {
    return NextResponse.json({ ok: false, error: UserDataError.invalid('entityId', 'entityId is required.').toJSON() }, { status: 400 });
  }

  const entity = await findEntityForUser(body.entityId, user.id);
  if (!entity) {
    return NextResponse.json({ ok: false, error: UserDataError.invalid('entityId', 'That entity is not yours.').toJSON() }, { status: 403 });
  }

  // 1. The gate. A passing run must exist AND the current state must still pass.
  const readyRun = await latestReadyRun(entity.id);
  if (!readyRun) {
    const error = ReadinessBlockedError(
      'This entity has not yet been reviewed, so it cannot be published. Run the complete review first.',
    );
    return NextResponse.json({ ok: false, error: error.toJSON() }, { status: 409 });
  }

  const current = await buildReadinessReport(entity.id, 'second_pass');
  if (current.status !== 'ready') {
    const first = current.blockingIssues[0];
    const error = ReadinessBlockedError(
      `ENTITY READINESS: ${current.score}% - BLOCKED. This entity cannot be published until every blocking issue is resolved.`,
      first ? `${first.title}: ${first.detail}` : current.summary,
    );
    await audit({
      userId: user.id,
      entityId: entity.id,
      action: 'publish.refused',
      actor: 'user',
      detail: { score: current.score, blocking: current.blockingIssues.length },
    });
    return NextResponse.json({ ok: false, error: error.toJSON() }, { status: 409 });
  }

  // 2. Provision the platform-controlled subdomain so there is always a working address.
  try {
    await ensurePlatformSubdomain(entity.id);
  } catch {
    /* the deploy step below reports the real problem */
  }

  // 3. Deploy.
  const requested =
    body.target === 'vercel' || body.target === 'platform_host' ? (body.target as DeploymentTarget) : undefined;
  const target = chooseTarget(requested);

  try {
    // The report computed for the gate above is handed to the deploy layer so it does not have to
    // evaluate the whole entity a second time. The deploy layer re-checks it regardless.
    const outcome = await deployEntity({
      entityId: entity.id,
      userId: user.id,
      target,
      readinessReport: { status: current.status, score: current.score },
    });
    return NextResponse.json({
      ok: true,
      data: {
        url: outcome.url,
        target: outcome.target,
        validation: outcome.validation,
        log: outcome.log,
      },
    });
  } catch (err) {
    const error = toActionableError(err);
    return NextResponse.json({ ok: false, error }, { status: error.status });
  }
}