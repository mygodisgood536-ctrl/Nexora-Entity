import { notFound } from 'next/navigation';
import Link from 'next/link';
import { STAGES, STAGE_BY_KEY, type StageKey } from '@nexora/core';
import { findEntityForUser, getActiveAiConfiguration, listEntitiesForUser, listStageProgress } from '@nexora/db';
import { requireUser } from '@/lib/server';
import StageForm from '@/components/stage-form';
import ProviderDock from '@/components/provider-dock';
import LivePreview from '@/components/live-preview';

export const dynamic = 'force-dynamic';

/**
 * The guided stage workbench.
 *
 * URL contract: `/app/stages/<stageKey>?entity=<entityId>`.
 *
 * The path segment is the *stage*, because that is what every producer of these links means:
 * the readiness engine emits `/app/stages/N_websites`, the entity-creation redirect emits
 * `/app/stages/A_identity`, and the dashboard's evidence cards emit the same. The entity is
 * carried separately in `?entity=` and is always ownership-checked, so a guessed entity id in
 * the query string can never reach another person's data.
 */
export default async function StagePage({
  params,
  searchParams,
}: {
  params: Promise<Record<string, string | string[] | undefined>>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await requireUser();
  const routeParams = await params;
  const query = await searchParams;

  const rawSlug = Array.isArray(routeParams['slug']) ? routeParams['slug'][0] : routeParams['slug'];
  if (!rawSlug) notFound();

  // The path segment names the stage. An unknown or missing stage falls back to the first stage
  // rather than 404ing, so a stale bookmark still lands somewhere useful.
  const stageFromPath = STAGE_BY_KEY[rawSlug as StageKey] ? (rawSlug as StageKey) : null;
  const stageFromQuery = typeof query['stage'] === 'string' ? (query['stage'] as StageKey) : null;
  const activeStage: StageKey =
    stageFromPath ?? (stageFromQuery && stageFromQuery in STAGE_BY_KEY ? stageFromQuery : 'A_identity');
  const stage = STAGE_BY_KEY[activeStage];

  // Resolve the entity. `?entity=` is preferred and is ownership-checked; without it we fall
  // back to this account's most recent entity. We never 404 here, because the stage is the
  // thing being viewed and the entity list may legitimately be re-ordered.
  const entities = await listEntitiesForUser(user.id);
  if (entities.length === 0) notFound();

  const requestedEntityId = typeof query['entity'] === 'string' ? query['entity'] : null;
  const entity = requestedEntityId ? await findEntityForUser(requestedEntityId, user.id) : entities[0];
  if (!entity) notFound();

  const [progress, aiConfig] = await Promise.all([listStageProgress(entity.id), getActiveAiConfiguration(user.id)]);
  const current = progress.find((p) => p.stage_key === activeStage);

  const openProvider = query['openProvider'] === '1' || !aiConfig;
  const stageHref = (key: StageKey) => `/app/stages/${key}?entity=${entity.id}`;

  return (
    <>
      <div className="nx-shell grid gap-6 py-6 lg:grid-cols-[16rem_minmax(0,1fr)] xl:grid-cols-[16rem_minmax(0,1fr)_22rem]">
        <nav aria-label="Stages" className="nx-rail self-start">
          {STAGES.map((s) => {
            const p = progress.find((x) => x.stage_key === s.key);
            const status = p?.status ?? 'pending';
            const isActive = s.key === activeStage;
            return (
              <Link
                key={s.key}
                href={stageHref(s.key)}
                className="nx-rail__item"
                data-status={status}
                data-active={isActive}
                aria-current={isActive ? 'page' : undefined}
              >
                <span className="nx-rail__letter">{s.letter}</span>
                <span className="min-w-0 truncate">{s.title}</span>
                <span className="nx-help">{s.requirement === 'evidence_minimum' ? 'min' : ''}</span>
              </Link>
            );
          })}
        </nav>

        <main id="main" className="min-w-0">
          <StageForm
            entityId={entity.id}
            stage={stage}
            initialData={(current?.data ?? {}) as Record<string, string | string[]>}
            initialStatus={current?.status ?? 'pending'}
            initialAutosaveAt={current?.touched_at ? new Date(current.touched_at).toISOString() : null}
          />
          <div className="nx-row mt-4">
            <Link href="/app" className="nx-btn nx-btn--ghost nx-btn--sm">
              Back to overview
            </Link>
          </div>
        </main>

        <div className="hidden xl:block">
          <div className="sticky top-20 nx-stack nx-stack--snug">
            <div className="nx-row justify-between">
              <p className="nx-eyebrow">Live preview</p>
              <Link href={`/app/preview/${entity.slug}`} className="nx-btn nx-btn--quiet nx-btn--sm">
                Open full
              </Link>
            </div>
            <LivePreview entityId={entity.id} />
            <p className="nx-help">
              The preview is the same design system that gets published. Sections appear and expand as your verified
              information does; nothing is filled in for show.
            </p>
          </div>
        </div>
      </div>

      <ProviderDock
        defaultOpen={openProvider}
        initial={
          aiConfig
            ? {
                providerId: aiConfig.provider_id,
                providerName: aiConfig.provider_name,
                modelId: aiConfig.model_id,
                modelName: aiConfig.model_name,
                verifiedAt: aiConfig.verified_at ? new Date(aiConfig.verified_at).toISOString() : null,
                lastError: aiConfig.last_error,
                lastErrorCode: aiConfig.last_error_code,
              }
            : null
        }
      />
    </>
  );
}