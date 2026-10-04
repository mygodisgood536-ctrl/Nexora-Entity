import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { z } from 'zod';
import { config } from '@nexora/core/config';
import { StageStatus, toActionableError, UserDataError, type StageKey } from '@nexora/core';
import {
  findEntityForUser,
  listStageProgress,
  resolveSession,
  saveStageProgress,
} from '@nexora/db';
import { ingestStages, runAnalysis } from '@nexora/engine';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const schema = z.object({
  entityId: z.string().uuid(),
  stageKey: z.enum([
    'A_identity', 'B_name_variants', 'C_about', 'D_professional_identity', 'E_career', 'F_education',
    'G_skills', 'H_organizations', 'I_projects', 'J_products_services', 'K_achievements',
    'L_publications_media', 'M_press_releases', 'N_websites', 'O_portfolio', 'P_social_profiles',
    'Q_photos', 'R_online_presence', 'S_public_contact', 'T_location', 'U_dates',
    'V_external_identity_links', 'W_other',
  ]),
  status: z.enum(['in_progress', 'complete', 'skipped']),
  data: z.record(z.string(), z.unknown()).default({}),
  /** Re-run the background analysis after saving. */
  analyse: z.boolean().default(false),
});

/**
 * Save a stage. Skipping is recorded as skipped, which explicitly does NOT mean the stage is
 * satisfied. Autosave uses the same endpoint, so an interrupted session never loses work.
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
  const parsed = schema.safeParse(payload);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    return NextResponse.json(
      { ok: false, error: UserDataError.invalid(first?.path.join('.') ?? 'form', first?.message ?? 'Check the stage data.').toJSON() },
      { status: 400 },
    );
  }

  const { entityId, stageKey, status, data } = parsed.data;
  const entity = await findEntityForUser(entityId, user.id);
  if (!entity) {
    return NextResponse.json({ ok: false, error: UserDataError.invalid('entityId', 'That entity is not yours.').toJSON() }, { status: 403 });
  }

  try {
    await saveStageProgress({
      entityId,
      stageKey: stageKey as StageKey,
      status: status as StageStatus,
      data,
      skipNote: status === 'skipped' ? 'Skipped by the person. Not satisfied.' : null,
    });

    await ingestStages(entityId, [stageKey as StageKey]);

    let analysis: unknown = null;
    if (parsed.data.analyse) {
      // Background analysis is best-effort here; it is also run on a schedule. A failure is
      // reported honestly but never rolls back the save.
      try {
        analysis = await runAnalysis(entityId, { stageKeys: [stageKey as StageKey] });
      } catch (err) {
        analysis = { error: toActionableError(err) };
      }
    }

    const stages = await listStageProgress(entityId);
    return NextResponse.json({
      ok: true,
      stage: stages.find((s) => s.stage_key === stageKey) ?? null,
      analysis,
    });
  } catch (err) {
    const error = toActionableError(err);
    return NextResponse.json({ ok: false, error }, { status: error.status });
  }
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const entityId = url.searchParams.get('entityId');
  const store = await cookies();
  const user = await resolveSession(store.get(config().sessionCookieName)?.value);
  if (!user) return NextResponse.json({ ok: false, error: { message: 'Sign in first.' } }, { status: 401 });
  if (!entityId) return NextResponse.json({ ok: false, error: UserDataError.invalid('entityId', 'entityId is required.').toJSON() }, { status: 400 });
  const entity = await findEntityForUser(entityId, user.id);
  if (!entity) return NextResponse.json({ ok: false, error: UserDataError.invalid('entityId', 'That entity is not yours.').toJSON() }, { status: 403 });
  return NextResponse.json({ ok: true, stages: await listStageProgress(entityId) });
}