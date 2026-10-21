import Link from 'next/link';
import { DeploymentTarget, PRODUCT_NAME } from '@nexora/core';
import {
  findEntityForUser,
  latestReadyRun,
  listDeployments,
  listDomains,
  liveDeployment,
} from '@nexora/db';
import { vercelDiagnostics } from '@nexora/deploy';
import { requireUser } from '@/lib/server';
import PublishConsole from '@/components/publish-console';

export const dynamic = 'force-dynamic';

export default async function PublishPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await requireUser('/app/publish');
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

  const [readyRun, deployments, domains, live, vercel] = await Promise.all([
    latestReadyRun(entity.id),
    listDeployments(entity.id),
    listDomains(entity.id),
    liveDeployment(entity.id),
    vercelDiagnostics(),
  ]);

  const availableTarget: DeploymentTarget = vercel.configured && vercel.reachable
    ? DeploymentTarget.vercel
    : DeploymentTarget.platformHost;

  return (
    <main id="main" className="nx-shell py-8">
      <div className="nx-stack nx-stack--loose">
        <div>
          <p className="nx-eyebrow">Publish</p>
          <h1 className="nx-title">{entity.display_name ?? 'This entity'}</h1>
          <p className="nx-subtitle">
            Your Entity Website is generated from the same design system you see in the preview, validated, then
            published. You do not need a Vercel, GitHub, Git or command-line account — Nexora Entity operates the
            hosting on your behalf.
          </p>
        </div>

        <div className="nx-card nx-card--pad nx-stack">
          <p className="nx-eyebrow">The gate</p>
          {readyRun ? (
            <>
              <div className="nx-row">
                <span className="nx-badge nx-badge--good nx-badge--dot">100% Entity Readiness — ready</span>
                <span className="nx-help">
                  Reviewed {new Date(readyRun.finished_at ?? readyRun.started_at).toLocaleString()}
                </span>
              </div>
              <p className="text-sm text-ink-600">
                The complete whole-entity review passed. Nexora Entity re-runs it every time your information changes, so a
                publication can only proceed while every blocking check still passes.
              </p>
            </>
          ) : (
            <>
              <div className="nx-notice nx-notice--stop">
                <p className="font-semibold">This entity has not reached 100% Entity Readiness.</p>
                <p className="mt-1 text-xs">
                  Nexora Entity will not publish a blocked entity. Complete the blocking items, then run the complete
                  review again.
                </p>
              </div>
              <div className="nx-row">
                <Link href={`/app/readiness?entity=${entity.id}`} className="nx-btn nx-btn--primary nx-btn--sm">
                  See what is blocking
                </Link>
              </div>
            </>
          )}
        </div>

        <PublishConsole
          entityId={entity.id}
          slug={entity.slug}
          canPublish={Boolean(readyRun)}
          availableTarget={availableTarget}
          vercelDetail={vercel.detail}
          initialUrl={live?.url ?? null}
          initialTarget={live?.target ?? null}
        />

        <div className="grid gap-4 md:grid-cols-2">
          <div className="nx-card nx-card--pad nx-stack">
            <p className="nx-eyebrow">Your addresses</p>
            {domains.length === 0 ? (
              <p className="nx-help">No address has been provisioned yet. Publishing creates one.</p>
            ) : (
              <ul className="nx-stack-sm nx-list">
                {domains.map((d) => (
                  <li key={d.id} className="nx-row justify-between text-sm">
                    <span className="min-w-0 truncate">
                      <span className="nx-mono">{d.hostname}</span>
                      {d.is_primary ? <span className="nx-badge nx-badge--accent ml-2">primary</span> : null}
                    </span>
                    <span
                      className={`nx-badge ${
                        d.status === 'active' ? 'nx-badge--good' : d.status === 'pending_dns' ? 'nx-badge--warn' : 'nx-badge--stop'
                      }`}
                    >
                      {d.status === 'active' ? 'Live' : d.status === 'pending_dns' ? 'Waiting for DNS' : d.status}
                    </span>
                  </li>
                ))}
              </ul>
            )}
            <p className="nx-help">
              You can connect a domain you already own at any time. Nexora Entity generates the records and verifies them
              for you — you do not need to understand DNS.
            </p>
          </div>

          <div className="nx-card nx-card--pad nx-stack">
            <p className="nx-eyebrow">Deployment history</p>
            {deployments.length === 0 ? (
              <p className="nx-help">Nothing has been published yet.</p>
            ) : (
              <div className="nx-table__scroll">
                <table className="nx-table">
                  <thead>
                    <tr>
                      <th>When</th>
                      <th>Target</th>
                      <th>Result</th>
                    </tr>
                  </thead>
                  <tbody>
                    {deployments.map((d) => (
                      <tr key={d.id}>
                        <td>{new Date(d.created_at).toLocaleString()}</td>
                        <td>{d.target === 'vercel' ? 'Vercel' : 'Platform hosting'}</td>
                        <td>
                          <span
                            className={`nx-badge ${
                              d.status === 'live' ? 'nx-badge--good' : d.status === 'failed' ? 'nx-badge--stop' : ''
                            }`}
                          >
                            {d.status}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>

        <p className="nx-help">
          {PRODUCT_NAME} publishes one clear canonical identity page per person with accurate structured data, a stable
          identifier, and only information that passed Nexora Entity&rsquo;s own verification rules. Search engines
          decide independently what to show with it.
        </p>
      </div>
    </main>
  );
}