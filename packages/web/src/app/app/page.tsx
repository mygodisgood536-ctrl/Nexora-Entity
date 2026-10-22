import Link from 'next/link';
import { cookies } from 'next/headers';
import { EVIDENCE_MINIMUMS, EVIDENCE_MINIMUMS_NOTICE, PRODUCT_NAME, STAGES } from '@nexora/core';
import {
  latestEvidenceMinimums,
  listEntitiesForUser,
  listStageProgress,
  latestReadinessRun,
  countPendingReviewItems,
  getActiveAiConfiguration,
} from '@nexora/db';
import { health as openCodeHealth } from '@nexora/opencode-bridge';
import { requireUser } from '@/lib/server';

export const dynamic = 'force-dynamic';

export default async function AppHome({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await requireUser('/app');
  const entities = await listEntitiesForUser(user.id);

  if (entities.length === 0) {
    return <FirstRun />;
  }

  const query = await searchParams;
  const store = await cookies();
  const requested = Array.isArray(query['entity']) ? query['entity'][0] : query['entity'];
  // `?entity=` takes precedence over the stored preference so a link can switch directly. It is
  // resolved against this account's own entity list, which is already scoped to `user.id`, so an
  // id belonging to somebody else is ignored rather than honoured.
  const activeId = requested ?? store.get('nexora_active_entity')?.value;
  const entity = entities.find((e) => e.id === activeId) ?? entities[0]!;
  const [run, minimums, pending, aiConfig, oc, progress] = await Promise.all([
    latestReadinessRun(entity.id),
    latestEvidenceMinimums(entity.id),
    countPendingReviewItems(entity.id),
    getActiveAiConfiguration(user.id),
    openCodeHealth(),
    listStageProgress(entity.id),
  ]);

  // "Continue where you left off" is derived from real progress, not a fixed list: the stages
  // shown are the first ones this entity has not completed, so the shortcut always points at
  // work that is actually outstanding.
  const completed = new Set(progress.filter((p) => p.status === 'complete').map((p) => p.stage_key));
  const openStages = STAGES.filter((s) => !completed.has(s.key));
  const nextStages = openStages.slice(0, 3);

  const ready = run?.status === 'ready';
  const score = run?.score ?? 0;
  // The stored run keeps the raw checks and issues; the human label is derived from them.
  const readinessLabel = run
    ? `ENTITY READINESS: ${Math.round(score)}% - ${ready ? 'READY' : 'BLOCKED'}`
    : 'Not yet reviewed';

  return (
    <main id="main" className="nx-shell nx-stack nx-stack--loose py-8">
      <EntityRail entities={entities} activeId={entity.id} />

      <div className="grid gap-6 lg:grid-cols-[1.4fr_0.9fr]">
        <div className="nx-stack nx-stack--loose">
          <div>
            <p className="nx-eyebrow">Your entity</p>
            <h1 className="nx-title">{entity.display_name ?? 'Untitled entity'}</h1>
            <p className="nx-help nx-mono">
              Stable identifier {entity.entity_uid} &middot; survives changes to your username, domain and design.
            </p>
          </div>

          <div className="nx-card nx-card--pad nx-stack">
            <div className="nx-row justify-between">
              <div>
                <p className="nx-eyebrow">Entity Readiness</p>
                <p className="nx-metric nx-metric--md">{readinessLabel}</p>
              </div>
              <span className={`nx-badge ${ready ? 'nx-badge--good' : 'nx-badge--warn'} nx-badge--dot`}>
                {ready ? 'Ready to publish' : 'Blocked'}
              </span>
            </div>
            <div className="nx-track" aria-hidden="true">
              <div
                className={`nx-track__fill ${ready ? 'nx-track__fill--good' : score > 60 ? '' : 'nx-track__fill--warn'}`}
                style={{ width: `${Math.max(2, Math.min(100, score))}%` }}
              />
            </div>
            <p className="text-sm leading-relaxed text-ink-500">{run?.summary ?? 'Run a review to see where this entity stands.'}</p>
            <div className="nx-row">
              <Link href={`/app/readiness?entity=${entity.id}`} className="nx-btn nx-btn--primary nx-btn--sm">
                Open readiness
              </Link>
              <Link href={`/app/review?entity=${entity.id}`} className="nx-btn nx-btn--ghost nx-btn--sm">
                Review items {pending > 0 ? `(${pending})` : ''}
              </Link>
              <Link href={`/app/publish?entity=${entity.id}`} className="nx-btn nx-btn--ghost nx-btn--sm">
                Publish
              </Link>
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-3">
            <Minimum
              label={EVIDENCE_MINIMUMS.websites.label}
              current={minimums?.websites_qualifying ?? 0}
              required={EVIDENCE_MINIMUMS.websites.required}
              href={`/app/stages/N_websites?entity=${entity.id}`}
            />
            <Minimum
              label={EVIDENCE_MINIMUMS.pressReleases.label}
              current={minimums?.press_qualifying ?? 0}
              required={EVIDENCE_MINIMUMS.pressReleases.required}
              href={`/app/stages/M_press_releases?entity=${entity.id}`}
            />
            <Minimum
              label={EVIDENCE_MINIMUMS.photos.label}
              current={minimums?.photos_qualifying ?? 0}
              required={EVIDENCE_MINIMUMS.photos.required}
              href={`/app/stages/Q_photos?entity=${entity.id}`}
            />
          </div>

          <p className="nx-help">{EVIDENCE_MINIMUMS_NOTICE}</p>
        </div>

        <aside className="nx-stack self-start">
          <div className="nx-card nx-card--pad nx-stack">
            <p className="nx-eyebrow">AI configuration</p>
            {aiConfig ? (
              <>
                <p className="nx-row">
                  <span className="nx-badge nx-badge--good nx-badge--dot">Active</span>
                  <span className="text-sm font-medium text-ink-800">
                    {aiConfig.provider_name} &middot; {aiConfig.model_name}
                  </span>
                </p>
                <p className="nx-help">
                  This is your account&rsquo;s active configuration. It powers every AI-assisted step until you change it.
                </p>
              </>
            ) : (
              <>
                <p className="text-sm text-ink-500">No verified AI configuration yet.</p>
                <Link href={`/app/stages/A_identity?entity=${entity.id}&openProvider=1`} className="nx-btn nx-btn--accent nx-btn--sm">
                  Choose a provider
                </Link>
              </>
            )}
          </div>

          <div className="nx-card nx-card--pad nx-stack">
            <p className="nx-eyebrow">Platform</p>
            <div className="nx-row">
              <span className={`nx-badge ${oc.healthy ? 'nx-badge--good' : 'nx-badge--stop'} nx-badge--dot`}>
                {oc.healthy ? `OpenCode ${oc.version ?? ''}` : 'OpenCode unavailable'}
              </span>
            </div>
            <p className="nx-help">
              Provider and model availability is read live from OpenCode. Nothing is hard-coded, so a provider or model that
              OpenCode adds or removes is reflected immediately.
            </p>
          </div>

          <div className="nx-card nx-card--pad nx-stack">
            <p className="nx-eyebrow">Continue where you left off</p>
            <div className="nx-stack-sm">
              {nextStages.length > 0 ? (
                nextStages.map((stage) => (
                  <Link
                    key={stage.key}
                    href={`/app/stages/${stage.key}?entity=${entity.id}`}
                    className="nx-btn nx-btn--ghost nx-btn--sm justify-start"
                  >
                    {stage.title}
                  </Link>
                ))
              ) : (
                <p className="nx-help">Every stage is complete. Run a review, then publish.</p>
              )}
            </div>
          </div>
        </aside>
      </div>
    </main>
  );
}

/**
 * The account's entities, plus the control to add another.
 *
 * This screen is the "Entities" destination in the studio navigation, so it has to do more than
 * show whichever entity happens to be active: a person may legitimately hold several — one per
 * person they are building a representation for — and until this existed the only way to get a
 * second entity was to sign out and back in. The header switcher cannot solve that on its own
 * because it is deliberately hidden while there is only one entity, which is precisely the moment
 * somebody decides they need a second one.
 */
function EntityRail({ entities, activeId }: { entities: { id: string; display_name: string | null; slug: string }[]; activeId: string }) {
  return (
    <section className="nx-card nx-card--pad nx-stack nx-stack--snug" aria-labelledby="entities-heading">
      <div className="nx-row justify-between">
        <p className="nx-eyebrow" id="entities-heading">
          {entities.length > 1 ? `Your entities (${entities.length})` : 'Your entity'}
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {entities.map((e) => {
          const active = e.id === activeId;
          return (
            <div key={e.id} className={`nx-card nx-card--pad nx-selectable ${active ? '' : 'opacity-80'}`} aria-current={active ? 'true' : undefined}>
              <div className="nx-row justify-between">
                <span className="min-w-0 truncate text-sm font-medium text-ink-900">{e.display_name ?? 'Untitled entity'}</span>
                {active ? <span className="nx-badge nx-badge--accent">Open</span> : null}
              </div>
              <p className="nx-help nx-mono mt-1">/{e.slug}</p>
              {!active ? (
                <Link href={`/app?entity=${e.id}`} className="nx-btn nx-btn--ghost nx-btn--sm mt-2">
                  Switch to this entity
                </Link>
              ) : null}
            </div>
          );
        })}
      </div>

      {/* A plain form post: the endpoint redirects a browser straight into the new entity's first
          stage, so creating a second entity is the same single step as creating the first. */}
      <form action="/api/entities" method="post" className="nx-row items-end gap-2">
        <div className="nx-field min-w-0 flex-1 sm:max-w-xs">
          <label className="nx-label" htmlFor="new-entity-name">
            Add another person
          </label>
          <input
            id="new-entity-name"
            name="displayName"
            className="nx-input"
            placeholder="Their full name (optional)"
            autoComplete="off"
          />
        </div>
        <button type="submit" className="nx-btn nx-btn--accent">
          Create entity
        </button>
      </form>
      <p className="nx-help">
        Each entity is built, reviewed and published on its own. Nothing you enter for one person is ever shown on
        another&rsquo;s page.
      </p>
    </section>
  );
}

function Minimum({ label, current, required, href }: { label: string; current: number; required: number; href: string }) {
  const met = current >= required;
  const pct = Math.min(100, Math.round((current / required) * 100));
  return (
    <Link href={href} className="nx-card nx-card--pad nx-card--link transition hover:border-ink-300">
      <div className="nx-row justify-between">
        <span className="text-sm font-medium text-ink-700">{label}</span>
        <span className={`nx-badge ${met ? 'nx-badge--good' : 'nx-badge--warn'}`}>
          {current}/{required}
        </span>
      </div>
      <div className="nx-track nx-track--spaced" aria-hidden="true">
        <div className={`nx-track__fill ${met ? 'nx-track__fill--good' : ''}`} style={{ width: `${Math.max(3, pct)}%` }} />
      </div>
    </Link>
  );
}

function FirstRun() {
  return (
    <main id="main" className="nx-shell py-16">
      <div className="mx-auto max-w-2xl text-center">
        <p className="nx-eyebrow">Welcome to {PRODUCT_NAME}</p>
        <h1 className="nx-display mt-2">Let&rsquo;s Build One Complete Representation Of Who You Are Online.</h1>
        <p className="nx-subtitle mx-auto mt-4">
          Create your entity and the AI provider and model panel opens immediately. Everything after that is guided: fill
          the stages you want, skip the rest, and Nexora Entity does the research, cross-checking and technical work.
        </p>
        <form action="/api/entities" method="post" className="mt-8 flex flex-wrap items-center justify-center gap-2">
          <button type="submit" className="nx-btn nx-btn--accent">
            Create entity
          </button>
        </form>
        <p className="nx-help mt-4">
          Creating an entity does not publish anything. Publication only happens after 100% Entity Readiness.
        </p>
      </div>
    </main>
  );
}
