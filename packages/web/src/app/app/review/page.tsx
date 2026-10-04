import Link from 'next/link';
import { requireUser } from '@/lib/server';
import {
  findEntityForUser,
  listConflicts,
  listIdentityLinks,
  listReviewItems,
  listSources,
} from '@nexora/db';
import { requireUser as _require } from '@/lib/server';
import ReviewQueue from '@/components/review-queue';

export const dynamic = 'force-dynamic';

export default async function ReviewPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await requireUser('/app/review');
  void _require;
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

  const [items, conflicts, links, sources] = await Promise.all([
    listReviewItems(entity.id),
    listConflicts(entity.id, true),
    listIdentityLinks(entity.id),
    listSources(entity.id),
  ]);

  return (
    <main id="main" className="nx-shell py-8">
      <div className="nx-stack" style={{ gap: '1.25rem' }}>
        <div>
          <p className="nx-eyebrow">Review queue</p>
          <h1 className="nx-title" style={{ marginTop: '0.35rem' }}>
            Only the decisions that genuinely need you
          </h1>
          <p className="nx-subtitle" style={{ marginTop: '0.5rem' }}>
            You are only interrupted when your decision is genuinely required: a contradiction between sources, a profile
            that may not be yours, or information Nexora Entity discovered and will not publish without your agreement.
          </p>
        </div>

        <div className="grid gap-4 sm:grid-cols-3">
          <Stat label="Needs your decision" value={items.filter((i) => i.status === 'pending').length} tone={items.filter((i) => i.status === 'pending').length > 0 ? 'warn' : 'good'} />
          <Stat label="Blocking issues" value={conflicts.filter((c) => c.severity === 'blocking').length} tone={conflicts.some((c) => c.severity === 'blocking') ? 'stop' : 'good'} />
          <Stat label="Sources confirmed as yours" value={links.filter((l) => l.resolved_state === 'confirmed' || l.user_decision === 'accept').length} tone="good" />
        </div>

        <ReviewQueue entityId={entity.id} initialItems={items} />

        <section className="nx-card nx-card--pad nx-stack">
          <p className="nx-eyebrow">Every source and how it was judged</p>
          <div className="nx-table__scroll">
            <table className="nx-table">
              <thead>
                <tr>
                  <th>Source</th>
                  <th>Read?</th>
                  <th>Identity</th>
                  <th>Counts for</th>
                  <th>Why</th>
                </tr>
              </thead>
              <tbody>
                {sources.map((s) => {
                  const link = links.find((l) => l.source_id === s.id);
                  return (
                    <tr key={s.id}>
                      <td className="max-w-[16rem]">
                        <span className="block truncate font-medium text-ink-800">{s.title ?? s.canonical_url}</span>
                        <span className="nx-mono block truncate text-ink-400">{s.canonical_url}</span>
                      </td>
                      <td>
                        <span className={`nx-badge ${s.inspection_status === 'inspected' ? 'nx-badge--good' : 'nx-badge--warn'}`}>
                          {s.inspection_status === 'inspected' ? 'Inspected' : s.inspection_status}
                        </span>
                      </td>
                      <td>
                        <span
                          className={`nx-badge ${
                            (link?.resolved_state === 'confirmed' || link?.user_decision === 'accept')
                              ? 'nx-badge--good'
                              : link?.resolved_state === 'rejected'
                                ? 'nx-badge--stop'
                                : ''
                          }`}
                        >
                          {link?.user_decision === 'accept'
                            ? 'You confirmed'
                            : link?.user_decision === 'reject'
                              ? 'You rejected'
                              : (link?.resolved_state ?? 'not assessed')}
                        </span>
                      </td>
                      <td>
                        <span className="nx-row gap-1">
                          {s.qualifies_websites ? <span className="nx-badge nx-badge--accent">website</span> : null}
                          {s.qualifies_press ? <span className="nx-badge nx-badge--accent">press</span> : null}
                          {!s.qualifies_websites && !s.qualifies_press ? <span className="nx-badge">no</span> : null}
                        </span>
                      </td>
                      <td className="max-w-[22rem] text-xs">
                        {s.access_detail ?? s.qualifiers.assessment ?? '—'}
                        {s.platform_note ? <span className="block text-ink-400">{s.platform_note}</span> : null}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="nx-help">
            A source that could not be read is shown as such. Nexora Entity never claims a source was checked when it was
            not, and never claims a profile is yours without supporting evidence.
          </p>
          <div className="nx-row">
            <Link href={`/app/readiness?entity=${entity.id}`} className="nx-btn nx-btn--ghost nx-btn--sm">
              Back to readiness
            </Link>
          </div>
        </section>
      </div>
    </main>
  );
}

function Stat({ label, value, tone }: { label: string; value: number; tone: 'good' | 'warn' | 'stop' }) {
  const cls = tone === 'good' ? 'nx-badge--good' : tone === 'warn' ? 'nx-badge--warn' : 'nx-badge--stop';
  return (
    <div className="nx-card nx-card--pad">
      <p className="nx-eyebrow">{label}</p>
      <div className="nx-row" style={{ marginTop: '0.35rem' }}>
        <span className="nx-title" style={{ fontSize: '1.6rem' }}>
          {value}
        </span>
        <span className={`nx-badge ${cls}`}>{value === 0 ? 'clear' : 'action'}</span>
      </div>
    </div>
  );
}