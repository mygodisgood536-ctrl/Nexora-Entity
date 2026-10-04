/**
 * The platform's own first-party hosting tier.
 *
 * A real, independently operated multi-tenant host, used when the platform holds no Vercel
 * deployment credential. It is not a mock: each release is written to disk, recorded with a
 * content hash, versioned (so a failed deploy can be rolled back), and served by the platform
 * over HTTP with per-tenant domain routing and correct caching.
 *
 * It is never presented to a user as a Vercel deployment. The interface states which tier
 * served the site.
 */

import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { config } from '@nexora/core/config';
import { createLogger, NexoraError } from '@nexora/core';
import { audit } from '@nexora/db';
import type { SiteArtefact } from './deploy';

const log = createLogger('deploy:platform-host');

export interface PlatformRelease {
  releaseId: string;
  entityId: string;
  slug: string;
  dir: string;
  url: string;
  buildHash: string;
  fileCount: number;
  bytes: number;
  writtenAt: string;
  previousReleaseId: string | null;
}

export interface PlatformHostRecord {
  entityId: string;
  slug: string;
  currentReleaseId: string;
  hostname: string;
  releases: { releaseId: string; buildHash: string; writtenAt: string; bytes: number }[];
}

function sitesRoot(): string {
  return path.join(config().repoRoot, 'storage', 'sites');
}

function releasesIndexPath(): string {
  return path.join(sitesRoot(), 'index.json');
}

/** Read the release index. */
export async function readIndex(): Promise<Record<string, PlatformHostRecord>> {
  const p = releasesIndexPath();
  try {
    return JSON.parse(await readFile(p, 'utf8')) as Record<string, PlatformHostRecord>;
  } catch {
    return {};
  }
}

async function writeIndex(index: Record<string, PlatformHostRecord>): Promise<void> {
  await mkdir(sitesRoot(), { recursive: true });
  await writeFile(releasesIndexPath(), JSON.stringify(index, null, 2), 'utf8');
}

/** Where a release's files live. */
export function releaseDir(entityId: string, releaseId: string): string {
  return path.join(sitesRoot(), entityId, releaseId);
}

/**
 * Write a release atomically: build into a staging directory, then swap the `current`
 * pointer. A partially written release can therefore never be served.
 */
export async function writePlatformDeployment(input: {
  entityId: string;
  slug: string;
  artefact: SiteArtefact;
}): Promise<{ url: string; releaseId: string }> {
  const cfg = config();
  const releaseId = `${Date.now().toString(36)}-${randomUUID().slice(0, 8)}`;
  const dir = releaseDir(input.entityId, releaseId);
  const staging = `${dir}.staging`;

  try {
    await rm(staging, { recursive: true, force: true });
    await mkdir(staging, { recursive: true });

    let bytes = 0;
    for (const f of input.artefact.files) {
      const target = path.join(staging, f.name);
      await mkdir(path.dirname(target), { recursive: true });
      await writeFile(target, f.contents);
      bytes += typeof f.contents === 'string' ? Buffer.byteLength(f.contents) : f.contents.length;
    }

    const buildHash = input.artefact.meta.jsonLd
      ? createHash('sha256').update(input.artefact.html).digest('hex').slice(0, 16)
      : createHash('sha256').update(input.artefact.html).digest('hex').slice(0, 16);

    await writeFile(
      path.join(staging, '.release.json'),
      JSON.stringify(
        {
          releaseId,
          entityId: input.entityId,
          slug: input.slug,
          buildHash,
          bytes,
          fileCount: input.artefact.files.length,
          writtenAt: new Date().toISOString(),
          canonicalUrl: input.artefact.canonicalUrl,
          published: input.artefact.model.published,
        },
        null,
        2,
      ),
      'utf8',
    );

    await rm(dir, { recursive: true, force: true });
    await mkdir(path.dirname(dir), { recursive: true });
    // Rename the staging directory into place. Same volume, so this is atomic.
    const { rename } = await import('node:fs/promises');
    await rename(staging, dir);

    const index = await readIndex();
    const previous = index[input.entityId]?.currentReleaseId ?? null;
    const hostname = `${input.slug}.${cfg.entityHostSuffix}`;
    index[input.entityId] = {
      entityId: input.entityId,
      slug: input.slug,
      currentReleaseId: releaseId,
      hostname,
      releases: [
        ...(index[input.entityId]?.releases ?? []).slice(-9),
        { releaseId, buildHash, writtenAt: new Date().toISOString(), bytes },
      ],
    };
    await writeIndex(index);

    const protocol = cfg.platformOrigin.startsWith('https://') ? 'https' : 'http';
    const url = `${protocol}://${hostname}`;
    log.info('platform release written', { entityId: input.entityId, releaseId, bytes });
    await audit({
      entityId: input.entityId,
      action: 'deployment.platform_release_written',
      actor: 'system',
      detail: { releaseId, buildHash, bytes, previousReleaseId: previous },
    });

    return { url, releaseId };
  } catch (err) {
    await rm(staging, { recursive: true, force: true }).catch(() => {});
    throw new NexoraError({
      code: 'platform_host_write_failed',
      domain: 'deployment',
      message: `The platform could not write the entity website to its hosting tier: ${err instanceof Error ? err.message : String(err)}`,
      retryable: true,
      remediation: [{ kind: 'retry', label: 'Try again', primary: true }],
      cause: err,
    });
  }
}

/** Resolve a path inside a release directory, refusing anything outside it. */
async function readReleasePath(
  record: PlatformHostRecord,
  pathname: string,
): Promise<{ file: string; releaseId: string; contentType: string } | null> {
  const dir = releaseDir(record.entityId, record.currentReleaseId);
  if (!existsSync(dir)) return null;

  const cleanPath = pathname === '/' || pathname === '' ? '/index.html' : pathname;
  const candidate = path.join(dir, cleanPath.replace(/^\/+/, ''));
  const resolved = path.resolve(candidate);
  // Path traversal guard: never serve anything outside the release directory.
  if (resolved !== path.resolve(dir) && !resolved.startsWith(path.resolve(dir) + path.sep)) return null;
  if (!existsSync(resolved)) return null;

  const { stat } = await import('node:fs/promises');
  if (!(await stat(resolved)).isFile()) return null;

  return { file: resolved, releaseId: record.currentReleaseId, contentType: contentTypeFor(resolved) };
}

/** Resolve the file to serve for a hostname. */
export async function resolveReleaseFile(
  hostname: string,
  pathname: string,
): Promise<{ file: string; releaseId: string; contentType: string } | null> {
  const index = await readIndex();
  const cleanHost = hostname.toLowerCase().split(':')[0] ?? '';

  const record = Object.values(index).find((r) => r.hostname.toLowerCase() === cleanHost);
  if (!record) return null;

  return readReleasePath(record, pathname);
}

/**
 * Resolve the file to serve for a slug.
 *
 * The platform controls the path form (`/e/<slug>/…`) as well as the subdomain, and the custom
 * domain of a given entity may not be the host that reached us. Both forms must reach the same
 * release, so the slug is resolved through the same index.
 */
export async function resolveReleaseFileForSlug(
  slug: string,
  pathname: string,
): Promise<{ file: string; releaseId: string; contentType: string } | null> {
  const index = await readIndex();
  const record = index[Object.values(index).find((r) => r.slug === slug)?.entityId ?? ''];
  if (!record) return null;

  return readReleasePath(record, pathname);
}

export function contentTypeFor(file: string): string {
  const ext = path.extname(file).toLowerCase();
  switch (ext) {
    case '.html':
      return 'text/html; charset=utf-8';
    case '.css':
      return 'text/css; charset=utf-8';
    case '.js':
      return 'text/javascript; charset=utf-8';
    case '.json':
      return 'application/json; charset=utf-8';
    case '.xml':
      return 'application/xml; charset=utf-8';
    case '.txt':
      return 'text/plain; charset=utf-8';
    case '.svg':
      return 'image/svg+xml';
    case '.png':
      return 'image/png';
    case '.jpg':
    case '.jpeg':
      return 'image/jpeg';
    case '.webp':
      return 'image/webp';
    case '.avif':
      return 'image/avif';
    case '.ico':
      return 'image/x-icon';
    case '.woff2':
      return 'font/woff2';
    default:
      return 'application/octet-stream';
  }
}

/** Cache headers for an entity site: HTML revalidated, immutable assets cached. */
export function cacheHeadersFor(file: string): Record<string, string> {
  if (file.endsWith('.html')) {
    return {
      'cache-control': 'public, max-age=0, s-maxage=60, stale-while-revalidate=600',
      'x-nexora-entity': 'entity-site',
    };
  }
  return {
    'cache-control': 'public, max-age=31536000, immutable',
    'x-nexora-entity': 'entity-site',
  };
}

/** Roll back to a previous release. Returns false when the release does not exist. */
export async function rollback(entityId: string, releaseId: string): Promise<boolean> {
  const index = await readIndex();
  const record = index[entityId];
  if (!record) return false;
  if (!record.releases.some((r) => r.releaseId === releaseId)) return false;
  if (!existsSync(releaseDir(entityId, releaseId))) return false;
  record.currentReleaseId = releaseId;
  await writeIndex(index);
  log.warn('rolled back platform release', { entityId, releaseId });
  return true;
}

/** List releases for an entity, newest first. */
export async function listReleases(entityId: string): Promise<PlatformHostRecord | null> {
  const index = await readIndex();
  return index[entityId] ?? null;
}

/** Remove every release for an entity. */
export async function purgeEntity(entityId: string): Promise<void> {
  const index = await readIndex();
  delete index[entityId];
  await writeIndex(index);
  await rm(path.join(sitesRoot(), entityId), { recursive: true, force: true });
}

export async function releaseFileCount(entityId: string, releaseId: string): Promise<number> {
  const dir = releaseDir(entityId, releaseId);
  try {
    const entries = await readdir(dir, { recursive: true });
    return entries.length;
  } catch {
    return 0;
  }
}