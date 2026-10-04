import Link from 'next/link';
import { redirect } from 'next/navigation';
import { EVIDENCE_MINIMUMS_NOTICE, PRODUCT_NAME } from '@nexora/core';
import {
  latestEvidenceMinimums,
  listEntitiesForUser,
  latestReadinessRun,
  countPendingReviewItems,
  getActiveAiConfiguration,
} from '@nexora/db';
import { health as openCodeHealth } from '@nexora/opencode-bridge';
import { requireUser } from '@/lib/server';

export const dynamic = 'force-dynamic';

export default async function AppHome() {
  const user = await requireUser('/app');
  const entities = await listEntitiesForUser(user.id);

  if (entities.length === 0) {
    return <FirstRun />;
  }

  const entity = entities[0]!;
  const [run, minimums, pending, aiConfig, oc] = await Promise.all([
    latestReadinessRun(entity.id),
    latestEvidenceMinimums(entity.id),
    countPendingReviewItems(entity.id),
    getActiveAiConfiguration(user.id),
    openCodeHealth(),
  ]);

  const ready = run?.status === 'ready';
  const score = run?.score ?? 0;
  // The stored run keeps the raw checks and issues; the human label is derived from them.
  const readinessLabel = run
    ? `ENTITY READINESS: ${Math.round(score)}% - ${ready ? 'READY' : 'BLOCKED'}`
    : 'Not yet reviewed';

  return (
    <main id="main" className="nx-shell py-8">
      <div className="grid gap-6 lg:grid-cols-[1.4fr_0.9fr]">
        <div className="nx-stack" style={{ gap: '1.25rem' }}>
          <div>
            <p className="nx-eyebrow">Your entity</p>
            <h1 className="nx-title" style={{ marginTop: '0.35rem' }}>
              {entity.display_name ?? 'Untitled entity'}
            </h1>
            <p className="nx-help nx-mono" style={{ marginTop: '0.25rem' }}>
              Stable identifier {entity.entity_uid} &middot; survives changes to your username, domain and design.
            </p>
          </div>

          <div className="nx-card nx-card--pad nx-stack">
            <div className="nx-row justify-between">
              <div>
                <p className="nx-eyebrow">Entity Readiness</p>
                <p className="nx-title" style={{ fontSize: '1.5rem', marginTop: '0.2rem' }}>
                  {readinessLabel}
                </p>
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
              label="Websites"
              current={minimums?.websites_qualifying ?? 0}
              required={5}
              href={`/app/stages/N_websites?entity=${entity.id}`}
            />
            <Minimum
              label="Press releases"
              current={minimums?.press_qualifying ?? 0}
              required={4}
              href={`/app/stages/M_press_releases?entity=${entity.id}`}
            />
            <Minimum
              label="Photos"
              current={minimums?.photos_qualifying ?? 0}
              required={4}
              href={`/app/stages/Q_photos?entity=${entity.id}`}
            />
          </div>

          <p className="nx-help">{EVIDENCE_MINIMUMS_NOTICE}</p>
        </div>

        <aside className="nx-stack self-start" style={{ gap: '1rem' }}>
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
              <Link href={`/app/stages/A_identity?entity=${entity.id}`} className="nx-btn nx-btn--ghost nx-btn--sm justify-start">
                Basic identity
              </Link>
              <Link href={`/app/stages/N_websites?entity=${entity.id}`} className="nx-btn nx-btn--ghost nx-btn--sm justify-start">
                Websites
              </Link>
              <Link href={`/app/stages/P_social_profiles?entity=${entity.id}`} className="nx-btn nx-btn--ghost nx-btn--sm justify-start">
                Profiles
              </Link>
            </div>
          </div>
        </aside>
      </div>
    </main>
  );
}

function Minimum({ label, current, required, href }: { label: string; current: number; required: number; href: string }) {
  const met = current >= required;
  const pct = Math.min(100, Math.round((current / required) * 100));
  return (
    <Link href={href} className="nx-card nx-card--pad no-underline transition hover:border-ink-300" style={{ color: 'inherit' }}>
      <div className="nx-row justify-between">
        <span className="text-sm font-medium text-ink-700">{label}</span>
        <span className={`nx-badge ${met ? 'nx-badge--good' : 'nx-badge--warn'}`}>
          {current}/{required}
        </span>
      </div>
      <div className="nx-track" style={{ marginTop: '0.5rem' }} aria-hidden="true">
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
        <h1 className="nx-display" style={{ marginTop: '0.5rem' }}>
          Let&rsquo;s build one complete representation of who you are online.
        </h1>
        <p className="nx-subtitle" style={{ margin: '1rem auto 0' }}>
          Create your entity and the AI provider and model panel opens immediately. Everything after that is guided: fill
          the stages you want, skip the rest, and Nexora Entity does the research, cross-checking and technical work.
        </p>
        <form action="/api/entities" method="post" className="mt-8 flex flex-wrap items-center justify-center gap-2">
          <button type="submit" className="nx-btn nx-btn--accent">
            Create entity
          </button>
        </form>
        <p className="nx-help" style={{ marginTop: '1rem' }}>
          Creating an entity does not publish anything. Publication only happens after 100% Entity Readiness.
        </p>
      </div>
    </main>
  );
}

void redirect;