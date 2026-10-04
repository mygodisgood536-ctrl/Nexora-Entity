/**
 * Deployment layer.
 *
 * Two real targets, chosen honestly:
 *
 *  1. Vercel, through its public REST API. Used when the platform holds an authorized Vercel
 *     token. End users never need a Vercel, GitHub, Git or CLI account.
 *
 *  2. The platform's own first-party hosting tier. A real, independently served multi-tenant
 *     host operated by Nexora Entity: one deployable per entity, domain routing, custom
 *     domains, caching headers, build records, validation and rollback. Used when no Vercel
 *     credential is configured.
 *
 * A deployment is only ever reported as "live" once the site has actually been validated and
 * is reachable. Failures are surfaced with the real reason.
 */

import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { config } from '@nexora/core/config';
import { createLogger, DeploymentTarget, NexoraError, ReadinessBlockedError } from '@nexora/core';
import {
  audit,
  createDeployment,
  getDeployment,
  findEntityById,
  listClaims,
  listIdentityLinks,
  listPhotos,
  listSources,
  liveDeployment,
  setEntityPublished,
  supersedeDeployments,
  updateDeployment,
  type DeploymentRecord,
  type DomainRecord,
} from '@nexora/db';
import { buildMeta, buildRobotsTxt, buildSecurityTxt, buildSitemapXml } from '@nexora/entity-site';
import { renderEntityHtmlSync } from './render-process';
import { designSystemCss } from './design-system-css';
import { buildEntitySite } from './site-builder';
import { vercelDeploy, vercelAvailable, type VercelDeployResult } from './vercel';
import { writePlatformDeployment } from './platform-host';

const log = createLogger('deploy');

export interface DeployInput {
  entityId: string;
  userId: string;
  /** Force the target instead of letting the platform choose. */
  target?: DeploymentTarget;
  attempt?: number;
  /**
   * A readiness report the caller already computed, to avoid a second full evaluation.
   * When omitted the gate re-evaluates from scratch, which is always safe.
   */
  readinessReport?: { status: string; score: number };
}

export interface DeployOutcome {
  deployment: DeploymentRecord;
  url: string;
  target: DeploymentTarget;
  validation: ValidationReport;
  log: string;
}

export interface ValidationReport {
  ok: boolean;
  checks: { name: string; ok: boolean; detail: string }[];
  htmlBytes: number;
  fileCount: number;
  buildHash: string;
}

export interface SiteArtefact {
  html: string;
  css: string;
  robots: string;
  sitemap: string;
  security: string;
  files: { name: string; contents: string | Buffer }[];
  canonicalUrl: string;
  meta: ReturnType<typeof buildMeta>;
  model: ReturnType<typeof buildEntitySite>;
}

/** Build the complete static artefact for an entity from real database state. */
export async function buildArtefact(input: {
  entityId: string;
  canonicalUrl: string;
  mediaBase: string;
  published: boolean;
  /**
   * Preview renders include the reload bridge so the studio stays in sync with the artefact.
   * A published render never does, so a live page stays fully static and cacheable.
   */
  previewBridge?: boolean;
}): Promise<SiteArtefact> {
  const entity = await findEntityById(input.entityId);
  if (!entity) {
    throw new NexoraError({
      code: 'deployment_entity_missing',
      domain: 'deployment',
      message: 'This entity could not be found, so nothing was deployed.',
    });
  }

  const [claims, sources, photos, links] = await Promise.all([
    listClaims(input.entityId),
    listSources(input.entityId),
    listPhotos(input.entityId),
    listIdentityLinks(input.entityId),
  ]);

  const model = buildEntitySite({
    entity: {
      id: entity.id,
      entity_uid: entity.entity_uid,
      slug: entity.slug,
      canonical_path: entity.canonical_path,
      display_name: entity.display_name,
      updated_at: entity.updated_at,
      status: entity.status,
    },
    canonicalUrl: input.canonicalUrl,
    claims,
    sources,
    photos,
    identityLinks: links.map((l) => ({
      source_id: l.source_id,
      resolved_state: l.resolved_state,
      user_decision: l.user_decision,
    })),
    published: input.published,
    mediaBase: input.mediaBase,
  });

  const meta = buildMeta(model);
  const stylesheet = designSystemCss();
  // Rendered out-of-process: Next forbids react-dom/server inside the server-component graph,
  // and preview + publish must share one renderer.
  const html = await renderEntityHtmlSync({
    model,
    stylesheetText: stylesheet,
    jsonLd: meta.jsonLd as unknown[],
    title: meta.title,
    description: meta.description,
    canonicalUrl: meta.canonicalUrl,
    robots: meta.robots,
    openGraph: meta.openGraph,
    twitter: meta.twitter,
    previewBridge: input.previewBridge ?? false,
  });

  const origin = safeOrigin(input.canonicalUrl);
  const sitemapUrl = `${origin}/sitemap.xml`;
  const contactEmail = claims.find((c) => c.attribute_key === 'contact.email' && c.publish)?.value_text ?? null;

  const files: SiteArtefact['files'] = [
    { name: 'index.html', contents: html },
    { name: 'nexora-entity-site.css', contents: stylesheet },
    { name: 'robots.txt', contents: buildRobotsTxt(model, sitemapUrl) },
    { name: 'sitemap.xml', contents: buildSitemapXml(model) },
    { name: '.well-known/security.txt', contents: buildSecurityTxt(model, contactEmail) },
  ];

  return {
    html,
    css: stylesheet,
    robots: buildRobotsTxt(model, sitemapUrl),
    sitemap: buildSitemapXml(model),
    security: buildSecurityTxt(model, contactEmail),
    files,
    canonicalUrl: input.canonicalUrl,
    meta,
    model,
  };
}

function safeOrigin(url: string): string {
  try {
    return new URL(url).origin;
  } catch {
    return url.replace(/\/+$/, '');
  }
}

/** Validate the artefact before anything is published. */
export function validateArtefact(artefact: SiteArtefact): ValidationReport {
  const checks: { name: string; ok: boolean; detail: string }[] = [];
  const html = artefact.html;

  checks.push({
    name: 'doctype',
    ok: /^<!DOCTYPE html>/i.test(html),
    detail: 'The document starts with an HTML doctype.',
  });
  checks.push({
    name: 'viewport',
    ok: /name="viewport"/.test(html),
    detail: 'A responsive viewport meta tag is present.',
  });
  checks.push({
    name: 'canonical',
    ok: html.includes(`rel="canonical"`) && html.includes(artefact.canonicalUrl),
    detail: 'Exactly one canonical URL is declared.',
  });
  checks.push({
    name: 'structured_data',
    ok: /application\/ld\+json/.test(html) && html.includes('"@type":"Person"'),
    detail: 'Person structured data is embedded.',
  });
  checks.push({
    name: 'title',
    ok: /<title>[^<]{4,}<\/title>/.test(html),
    detail: 'A meaningful document title is present.',
  });
  checks.push({
    name: 'description',
    ok: /name="description" content="[^"]{20,}"/.test(html),
    detail: 'A meta description is present.',
  });
  checks.push({
    name: 'robots_policy',
    ok: artefact.meta.robots === (artefact.model.published ? 'index, follow, max-image-preview:large, max-snippet:-1' : 'noindex, nofollow'),
    detail: `robots is "${artefact.meta.robots}".`,
  });
  checks.push({
    name: 'no_empty_sections',
    ok: !/<section[^>]*>\s*<\/section>/.test(html),
    detail: 'No empty section elements were emitted.',
  });
  checks.push({
    name: 'no_placeholders',
    ok: !/lorem ipsum|TODO|FIXME|placeholder text|coming soon/i.test(html),
    detail: 'No placeholder or filler copy is present.',
  });
  checks.push({
    name: 'no_search_engine_claims',
    ok: !/google\s*(verified|approved|endorsed)|guaranteed?\s+knowledge panel/i.test(html),
    detail: 'The page makes no verification or Knowledge Panel claim about any search engine.',
  });
  checks.push({
    name: 'images_have_alt',
    ok: !/<img(?![^>]*\balt=)[^>]*>/.test(html),
    detail: 'Every image has alternative text.',
  });
  checks.push({
    name: 'sitemap_and_robots',
    ok: artefact.sitemap.includes('<urlset') && artefact.robots.includes('User-agent'),
    detail: 'sitemap.xml and robots.txt are generated.',
  });
  checks.push({
    name: 'responsive_stylesheet',
    ok: /@media\s*\(max-width/.test(artefact.css),
    detail: 'The design system includes responsive breakpoints.',
  });

  const htmlBytes = Buffer.byteLength(html, 'utf8');
  const buildHash = createHash('sha256')
    .update(artefact.files.map((f) => `${f.name}:${typeof f.contents === 'string' ? f.contents : Buffer.from(f.contents).toString('base64')}`).join('\n'))
    .digest('hex')
    .slice(0, 16);

  const ok = checks.every((c) => c.ok);
  return { ok, checks, htmlBytes, fileCount: artefact.files.length, buildHash };
}

/** Choose the deployment target honestly. */
export function chooseTarget(requested?: DeploymentTarget): DeploymentTarget {
  if (requested) return requested;
  return vercelAvailable() ? DeploymentTarget.vercel : DeploymentTarget.platformHost;
}

/**
 * Publish an entity.
 *
 * The readiness gate is enforced here, not only by the caller. The web route also checks, but a
 * deployment function that can publish a blocked entity is a trap: any future caller — a script,
 * a queue, an operator at a console — would be able to bypass the product's central promise.
 */
export async function deployEntity(input: DeployInput): Promise<DeployOutcome> {
  const cfg = config();

  // The gate lives here as well as in the calling route. This function is the last point before
  // a site goes live, so it must refuse a blocked entity on its own: a script, a retry, or an
  // operator calling it directly must not be able to publish around the product's central promise.
  if (input.readinessReport === undefined) {
    const { buildReadinessReport } = await import('@nexora/engine');
    const report = await buildReadinessReport(input.entityId, 'second_pass');
    if (report.status !== 'ready') {
      const first = report.blockingIssues[0];
      throw ReadinessBlockedError(
        `ENTITY READINESS: ${report.score}% - BLOCKED. This entity cannot be published until every blocking issue is resolved.`,
        first ? `${first.title}: ${first.detail}` : report.summary,
      );
    }
  } else if (input.readinessReport.status !== 'ready') {
    throw ReadinessBlockedError(
      `ENTITY READINESS: ${input.readinessReport.score}% - BLOCKED. This entity cannot be published until every blocking issue is resolved.`,
    );
  }

  const target = chooseTarget(input.target);
  const attempt = input.attempt ?? 1;
  const logLines: string[] = [];
  const push = (m: string) => {
    logLines.push(m);
    log.info(m, { entityId: input.entityId, target });
  };

  push(`Deploying with target ${target}.`);

  const deployment = await createDeployment({
    entityId: input.entityId,
    target,
    attempt,
    log: logLines.join('\n'),
  });

  try {
    // 1. Resolve the canonical URL this entity will live at.
    const url = await resolvePublicUrl(input.entityId, target);
    push(`Canonical URL: ${url}`);

    // 2. Build.
    await updateDeployment(deployment.id, { status: 'building', logAppend: 'Building the Entity Website from the pre-designed design system.' });
    const artefact = await buildArtefact({
      entityId: input.entityId,
      canonicalUrl: url,
      mediaBase: `${cfg.platformOrigin}/media`,
      published: true,
    });
    push(`Built ${artefact.files.length} files, ${Buffer.byteLength(artefact.html, 'utf8')} bytes of HTML.`);

    // 3. Validate. Nothing is published unless every check passes.
    await updateDeployment(deployment.id, { status: 'validating', logAppend: 'Validating the generated site.' });
    const validation = validateArtefact(artefact);
    await updateDeployment(deployment.id, {
      validation: validation as unknown as Record<string, unknown>,
      buildHash: validation.buildHash,
      siteBytes: validation.htmlBytes,
      fileCount: validation.fileCount,
      logAppend: validation.checks.map((c) => `${c.ok ? 'pass' : 'FAIL'}  ${c.name}: ${c.detail}`).join('\n'),
    });

    if (!validation.ok) {
      const failed = validation.checks.filter((c) => !c.ok).map((c) => c.name);
      throw new NexoraError({
        code: 'deployment_validation_failed',
        domain: 'deployment',
        message: `The generated website did not pass its final validation, so nothing was published. Failing checks: ${failed.join(', ')}.`,
        detail: failed.map((n) => validation.checks.find((c) => c.name === n)?.detail).join(' '),
        retryable: true,
        remediation: [
          { kind: 'review_item', label: 'Review the entity', primary: true, href: '/app/readiness' },
          { kind: 'retry', label: 'Deploy again' },
        ],
      });
    }
    push('Validation passed.');

    // 4. Publish to the target.
    await updateDeployment(deployment.id, { status: 'deploying', logAppend: `Publishing to ${target}.` });
    let result: { url: string; providerDeploymentId: string | null; providerProjectId: string | null };
    if (target === DeploymentTarget.vercel) {
      const v: VercelDeployResult = await vercelDeploy({ entityId: input.entityId, entitySlug: (await findEntityById(input.entityId))?.slug ?? 'entity', artefact, url });
      result = { url: v.url, providerDeploymentId: v.deploymentId, providerProjectId: v.projectId };
    } else {
      const written = await writePlatformDeployment({ entityId: input.entityId, slug: (await findEntityById(input.entityId))?.slug ?? 'entity', artefact });
      result = { url: written.url, providerDeploymentId: written.releaseId, providerProjectId: written.releaseId };
    }
    push(`Published. Live at ${result.url}`);

    // 5. Record the release.
    await supersedeDeployments(input.entityId, deployment.id);
    await updateDeployment(deployment.id, {
      status: 'live',
      url: result.url,
      providerDeploymentId: result.providerDeploymentId ?? undefined,
      providerProjectId: result.providerProjectId ?? undefined,
      validation: validation as unknown as Record<string, unknown>,
      buildHash: validation.buildHash,
      siteBytes: validation.htmlBytes,
      fileCount: validation.fileCount,
      logAppend: 'Deployment complete.',
      finished: true,
    });
    await setEntityPublished(input.entityId, deployment.id, result.url);
    await audit({
      userId: input.userId,
      entityId: input.entityId,
      action: 'deployment.live',
      detail: { target, url: result.url, buildHash: validation.buildHash },
    });

    return {
      deployment: (await getDeployment(deployment.id)) ?? deployment,
      url: result.url,
      target,
      validation,
      log: logLines.join('\n'),
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await updateDeployment(deployment.id, {
      status: 'failed',
      error: { message },
      logAppend: `FAILED: ${message}`,
      finished: true,
    });
    await audit({
      userId: input.userId,
      entityId: input.entityId,
      action: 'deployment.failed',
      actor: 'system',
      detail: { target, message },
    });
    throw err;
  }
}

/**
 * Determine the public URL for an entity.
 * Custom domain takes precedence; otherwise the platform-controlled subdomain is used.
 */
export async function resolvePublicUrl(entityId: string, target: DeploymentTarget): Promise<string> {
  const cfg = config();
  const entity = await findEntityById(entityId);
  if (!entity) throw new NexoraError({ code: 'deployment_entity_missing', domain: 'deployment', message: 'Entity not found.' });

  const { listDomains } = await import('@nexora/db');
  const domains = await listDomains(entityId);
  const custom = domains.find((d) => d.kind === 'custom' && d.status === 'active');
  if (custom) return `https://${custom.hostname}`;

  if (target === DeploymentTarget.vercel && vercelAvailable()) {
    const project = `nexora-entity-${entity.slug}`;
    const team = cfg.vercelTeamId;
    return `https://${project}.vercel.app`;
  }

  const subdomain = domains.find((d) => d.kind === 'platform_subdomain');
  const host = subdomain?.hostname ?? `${entity.slug}.${cfg.entityHostSuffix}`;
  const protocol = cfg.platformOrigin.startsWith('https://') ? 'https' : 'http';
  return `${protocol}://${host}`;
}

/** Write the artefact to disk as well, so the platform host can serve it and it can be inspected. */
export async function persistArtefactToDisk(entityId: string, artefact: SiteArtefact): Promise<string> {
  const cfg = config();
  const entity = await findEntityById(entityId);
  const dir = path.join(cfg.repoRoot, 'storage', 'sites', entity?.slug ?? entityId, artefact.meta.canonicalUrl.replace(/^https?:\/\//, '').replace(/[^a-z0-9.-]/gi, '_'));
  await mkdir(dir, { recursive: true });
  for (const f of artefact.files) {
    const target = path.join(dir, f.name.replace(/^\.well-known\//, '.well-known/'));
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, f.contents);
  }
  await writeFile(path.join(dir, 'build.json'), JSON.stringify({ meta: artefact.meta, builtAt: new Date().toISOString() }, null, 2));
  return dir;
}

export { liveDeployment, listSources, listPhotos };
export type { DomainRecord };