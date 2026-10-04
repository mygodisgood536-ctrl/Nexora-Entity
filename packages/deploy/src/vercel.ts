/**
 * Vercel deployment integration, using Vercel's public REST API.
 *
 * End users never need their own Vercel, GitHub, Git or CLI account: Nexora Entity holds the
 * authorized credential and deploys on their behalf. Each entity gets its own Vercel project,
 * which is what gives genuine multi-tenant isolation, per-tenant domains and per-tenant builds.
 *
 * When no token is configured this reports honestly and the caller uses the platform's own
 * hosting tier instead. It never pretends to have deployed to Vercel.
 */

import { config } from '@nexora/core/config';
import { createLogger, NexoraError } from '@nexora/core';
import type { SiteArtefact } from './deploy';

const log = createLogger('deploy:vercel');

const API = 'https://api.vercel.com';

export function vercelAvailable(): boolean {
  return Boolean(config().vercelToken);
}

export interface VercelDeployResult {
  url: string;
  deploymentId: string;
  projectId: string;
  inspectorUrl: string | null;
  /** Which Vercel APIs were used. */
  used: string[];
}

interface VercelErrorBody {
  error?: { code?: string; message?: string };
  message?: string;
}

async function vercelFetch<T>(
  path: string,
  init: RequestInit & { query?: Record<string, string> } = {},
): Promise<T> {
  const token = config().vercelToken;
  if (!token) {
    throw new NexoraError({
      code: 'vercel_not_configured',
      domain: 'configuration',
      message:
        'Vercel deployment is not available because the platform has no Vercel deployment credential configured.',
      detail:
        'Set VERCEL_TOKEN (and optionally VERCEL_TEAM_ID) for the platform. Until then Nexora Entity deploys to its own first-party hosting tier instead.',
    });
  }
  const url = new URL(`${API}${path}`);
  for (const [k, v] of Object.entries(init.query ?? {})) url.searchParams.set(k, v);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 120_000);
  try {
    const res = await fetch(url, {
      ...init,
      signal: controller.signal,
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
        ...(config().vercelTeamId ? { 'x-vercel-team-id': config().vercelTeamId } : {}),
        ...(init.headers ?? {}),
      },
    });
    const text = await res.text();
    const parsed = text ? (JSON.parse(text) as unknown) : undefined;
    if (!res.ok) {
      const body = parsed as VercelErrorBody | undefined;
      const message = body?.error?.message ?? body?.message ?? `Vercel returned HTTP ${res.status}`;
      const code = body?.error?.code ?? `vercel_http_${res.status}`;
      throw new NexoraError({
        code,
        domain: 'deployment',
        message: `Vercel rejected the deployment: ${message}`,
        detail: message,
        retryable: res.status >= 500 || res.status === 429,
        remediation: [
          { kind: 'retry', label: 'Try again', primary: true },
          { kind: 'configure_platform', label: 'Platform configuration' },
        ],
      });
    }
    return parsed as T;
  } catch (err) {
    if (err instanceof NexoraError) throw err;
    throw new NexoraError({
      code: 'vercel_network_error',
      domain: 'deployment',
      message: `Could not reach Vercel: ${err instanceof Error ? err.message : String(err)}`,
      retryable: true,
      remediation: [{ kind: 'retry', label: 'Try again', primary: true }],
      cause: err,
    });
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Deploy the entity site to Vercel as a static site.
 *
 * Uses: POST /v13/projects (create project if needed), then
 *       POST /v13/deployments with a file map. The project is a plain static build: the
 *       pre-designed design system rendered with this entity's verified data. No per-user
 *       application code is generated.
 */
export async function vercelDeploy(input: {
  entityId: string;
  entitySlug: string;
  artefact: SiteArtefact;
  url: string;
}): Promise<VercelDeployResult> {
  const projectName = `nexora-entity-${input.entitySlug}`.toLowerCase().slice(0, 58);
  const used: string[] = [];

  // 1. Ensure the project exists. A Vercel-compatible multi-tenant architecture: one project
  //    per entity, so builds, domains and caches are isolated.
  try {
    await vercelFetch(`/v9/projects/${encodeURIComponent(projectName)}`, { method: 'GET' });
    used.push('GET /v9/projects/:name');
  } catch {
    await vercelFetch('/v13/projects', {
      method: 'POST',
      body: JSON.stringify({
        name: projectName,
        framework: null,
        buildCommand: '',
        outputDirectory: '',
        installCommand: '',
        cleanUrls: true,
      }),
    });
    used.push('POST /v13/projects');
  }

  // 2. Build the file map. Vercel's file map keys are paths relative to the project root.
  const files: Record<string, { file: string; encoding: 'utf-8' | 'base64'; data: string }> = {};
  for (const f of input.artefact.files) {
    if (typeof f.contents === 'string') {
      files[f.name] = { file: f.name, encoding: 'utf-8', data: f.contents };
    } else {
      files[f.name] = { file: f.name, encoding: 'base64', data: Buffer.from(f.contents).toString('base64') };
    }
  }

  // 3. Create the deployment.
  const deployment = await vercelFetch<{
    id: string;
    url: string;
    inspectorUrl?: string;
    readyState?: string;
  }>('/v13/deployments', {
    method: 'POST',
    query: { name: projectName, forceNew: '1', skipAutoDetectionConfirmation: '1' },
    body: JSON.stringify({
      name: projectName,
      target: 'production',
      project: projectName,
      files,
      projectSettings: {
        framework: null,
        // Static output: the design system rendered with this entity's data.
        outputDirectory: undefined,
        installCommand: '',
        buildCommand: '',
        devCommand: '',
        cleanUrls: true,
        trailingSlash: false,
      },
      routes: [
        { src: '/', dest: '/index.html' },
        { src: '/nexora-entity-site.css', dest: '/nexora-entity-site.css' },
        { handle: 'filesystem' },
      ],
      meta: {
        githubCommitSha: `nexora-${input.entityId}`,
        githubCommitRef: `entity/${input.entitySlug}`,
        source: 'nexora-entity',
      },
    }),
  });
  used.push('POST /v13/deployments');

  log.info('Vercel deployment created', { project: projectName, id: deployment.id, state: deployment.readyState });

  return {
    url: `https://${deployment.url}`,
    deploymentId: deployment.id,
    projectId: projectName,
    inspectorUrl: deployment.inspectorUrl ?? null,
    used,
  };
}

/** Assign a custom domain to a Vercel project. */
export async function vercelAssignDomain(input: {
  projectId: string;
  hostname: string;
}): Promise<{ ok: boolean; verification: { type: string; name: string; value: string }[] }> {
  const result = await vercelFetch<{
    verified?: boolean;
    verification?: { type: string; name: string; value: string }[];
  }>(`/v10/projects/${encodeURIComponent(input.projectId)}/domains`, {
    method: 'POST',
    body: JSON.stringify({ name: input.hostname }),
  });
  return { ok: result.verified === true, verification: result.verification ?? [] };
}

/** Remove a domain from a Vercel project. */
export async function vercelRemoveDomain(projectId: string, hostname: string): Promise<void> {
  await vercelFetch(`/v9/projects/${encodeURIComponent(projectId)}/domains/${encodeURIComponent(hostname)}`, {
    method: 'DELETE',
  });
}

/** Point a Vercel project at its own canonical subdomain. */
export async function vercelAssignSubdomain(input: {
  projectId: string;
  subdomain: string;
}): Promise<void> {
  await vercelFetch(`/v9/projects/${encodeURIComponent(input.projectId)}/domains`, {
    method: 'POST',
    body: JSON.stringify({ name: input.subdomain }),
  });
}

/** Diagnostics shown honestly on the platform's deployment screen. */
export async function vercelDiagnostics(): Promise<{
  configured: boolean;
  reachable: boolean;
  teamId: string | null;
  scope: string;
  detail: string;
}> {
  const cfg = config();
  if (!cfg.vercelToken) {
    return {
      configured: false,
      reachable: false,
      teamId: cfg.vercelTeamId ?? null,
      scope: cfg.vercelProjectScope,
      detail:
        'No Vercel deployment credential is configured for this platform, so entity websites are published to the platform’s own first-party hosting tier.',
    };
  }
  try {
    const user = await vercelFetch<{ user?: { username?: string } }>('/v2/user');
    return {
      configured: true,
      reachable: true,
      teamId: cfg.vercelTeamId ?? null,
      scope: cfg.vercelProjectScope,
      detail: `Authenticated to Vercel as ${user.user?.username ?? 'unknown'}.`,
    };
  } catch (err) {
    return {
      configured: true,
      reachable: false,
      teamId: cfg.vercelTeamId ?? null,
      scope: cfg.vercelProjectScope,
      detail: err instanceof Error ? err.message : 'Vercel is configured but not reachable.',
    };
  }
}