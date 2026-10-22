/**
 * Runtime configuration. Read from the environment, validated once, with honest defaults
 * that keep the product functional in development.
 */

import { existsSync } from 'node:fs';
import path from 'node:path';

const bool = (v: string | undefined, dflt: boolean): boolean => {
  if (v === undefined) return dflt;
  return ['1', 'true', 'yes', 'on'].includes(v.toLowerCase());
};

const int = (v: string | undefined, dflt: number): number => {
  const n = Number.parseInt(v ?? '', 10);
  return Number.isFinite(n) ? n : dflt;
};

/**
 * Locate the project root by walking up from the current directory.
 *
 * A fixed `../..` is wrong: it resolves correctly when the process runs from inside a package
 * (`packages/web`) but to the user's home directory when a script runs from the repo root, which
 * silently breaks every path built on it — storage, the OpenCode binary, deployment output. The
 * root is therefore found by looking for the marker that actually identifies it.
 */
function findRepoRoot(): string {
  const marker = 'packages';
  let dir = process.cwd();
  for (let i = 0; i < 12; i += 1) {
    if (existsSync(path.join(dir, marker, 'core', 'package.json'))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return process.cwd();
}

const repoRoot = process.env.NEXORA_REPO_ROOT ?? findRepoRoot();

export interface AppConfig {
  env: 'development' | 'test' | 'production';
  repoRoot: string;
  /** Public origin of the platform itself. */
  platformOrigin: string;
  /** Apex domain used for platform-controlled entity subdomains, e.g. nexoraentity.com. */
  publicApexDomain: string;
  /** Host that resolves entity subdomains to this platform in local/dev environments. */
  entityHostSuffix: string;
  port: number;
  databaseUrl: string;
  databaseUrlTest: string;
  storageDir: string;
  photoDir: string;
  portfolioDir: string;
  sessionCookieName: string;
  sessionTtlDays: number;
  /** Whether the session cookie is issued with the `Secure` attribute. True by default in production. */
  cookieSecure: boolean;
  secretKey: string;
  /** Vercel. Optional. When absent the platform uses its own first-party hosting tier. */
  vercelToken: string | undefined;
  vercelTeamId: string | undefined;
  vercelProjectScope: string;
  /** OpenCode bridge. */
  opencodeBinary: string | undefined;
  opencodeHost: string;
  opencodePort: number;
  /** Full base URL of the bridge, e.g. `https://opencode.internal.example`. Takes precedence over host/port. */
  opencodeUrl: string | undefined;
  /**
   * Base URL of the OpenCode inference gateway.
   *
   * The OpenCode Console serves both the workspace configuration (`<console>/api/v2/config`)
   * and model inference (`<inference>/openai/v1/chat/completions`) from two different origins.
   * When the bridge is pointed at the Console, this defaults to the sibling inference origin.
   */
  opencodeInferenceUrl: string | undefined;
  /** Bearer token presented to the bridge. Required once the bridge is not on loopback. */
  opencodeToken: string | undefined;
  /** Whether local tooling may start a managed OpenCode process. The web application never does. */
  opencodeManaged: boolean;
  opencodeRequestTimeoutMs: number;
  opencodeProbeTimeoutMs: number;
  /** Outbound HTTP. */
  httpTimeoutMs: number;
  httpUserAgent: string;
  httpMaxBytes: number;
  httpMaxRedirects: number;
  /** Cron secret for scheduled maintenance endpoints. */
  cronSecret: string;
  /** Deployment: allow the platform host tier. */
  allowPlatformHostDeploy: boolean;
  logLevel: 'debug' | 'info' | 'warn' | 'error';
}

function resolveDir(candidates: (string | undefined)[], dflt: string): string {
  for (const c of candidates) {
    if (c && existsSync(c)) return path.resolve(c);
  }
  return path.resolve(repoRoot, dflt);
}

function load(): AppConfig {
  const env = (process.env.NODE_ENV ?? 'development') as AppConfig['env'];
  const isProd = env === 'production';
  return {
    env,
    repoRoot,
    platformOrigin: process.env.NEXORA_PLATFORM_ORIGIN ?? (isProd ? 'http://127.0.0.1:4311' : 'http://127.0.0.1:4311'),
    publicApexDomain: (process.env.NEXORA_PUBLIC_APEX_DOMAIN ?? 'nexoraentity.com').toLowerCase(),
    entityHostSuffix: (process.env.NEXORA_ENTITY_HOST_SUFFIX ?? process.env.NEXORA_PUBLIC_APEX_DOMAIN ?? 'nexoraentity.com').toLowerCase(),
    port: int(process.env.PORT ?? process.env.NEXORA_PORT, 4311),
    databaseUrl: process.env.DATABASE_URL ?? 'postgres://nexora_entity:nexora_entity@127.0.0.1:5433/nexora_entity_dev',
    databaseUrlTest: process.env.DATABASE_URL_TEST ?? 'postgres://nexora_entity:nexora_entity@127.0.0.1:5433/nexora_entity_test',
    storageDir: resolveDir([process.env.NEXORA_STORAGE_DIR], 'storage'),
    photoDir: resolveDir([process.env.NEXORA_PHOTO_DIR], path.join('storage', 'photos')),
    portfolioDir: resolveDir([process.env.NEXORA_PORTFOLIO_DIR], path.join('storage', 'portfolios')),
    sessionCookieName: process.env.NEXORA_SESSION_COOKIE ?? 'nexora_session',
    sessionTtlDays: int(process.env.NEXORA_SESSION_TTL_DAYS, 30),
    /**
     * Whether the session cookie carries `Secure`.
     *
     * Defaults to true whenever `NODE_ENV=production`, so a production deployment cannot silently
     * ship a session cookie without the flag just because `NEXORA_PLATFORM_ORIGIN` was left unset.
     * It is overridable only through an explicit `NEXORA_COOKIE_SECURE`, which exists so that
     * someone can deliberately run a production build behind plain HTTP in a test environment.
     */
    cookieSecure: bool(
      process.env.NEXORA_COOKIE_SECURE,
      isProd || (process.env.NEXORA_PLATFORM_ORIGIN ?? '').startsWith('https://'),
    ),
    secretKey: process.env.NEXORA_SECRET_KEY ?? 'nexora-entity-development-secret-change-me',
    vercelToken: process.env.VERCEL_TOKEN ?? process.env.NEXORA_VERCEL_TOKEN ?? undefined,
    vercelTeamId: process.env.VERCEL_TEAM_ID ?? process.env.NEXORA_VERCEL_TEAM_ID ?? undefined,
    vercelProjectScope: process.env.NEXORA_VERCEL_SCOPE ?? 'nexora-entity',
    opencodeBinary: process.env.OPENCODE_BIN ?? process.env.NEXORA_OPENCODE_BIN ?? undefined,
    opencodeHost: process.env.NEXORA_OPENCODE_HOST ?? '127.0.0.1',
    opencodePort: int(process.env.NEXORA_OPENCODE_PORT, 4137),
    /**
     * Full base URL of the OpenCode bridge, e.g. `https://opencode.internal.example`.
     *
     * This is the setting that makes a cloud-hosted bridge possible: set it and the application
     * attaches over HTTPS instead of looking for a process on loopback. It takes precedence over
     * host/port.
     */
    opencodeUrl: process.env.NEXORA_OPENCODE_URL ?? undefined,
    opencodeInferenceUrl: process.env.NEXORA_OPENCODE_INFERENCE_URL ?? undefined,
    /** Bearer token presented to the bridge. Required once the bridge is not on loopback. */
    opencodeToken: process.env.NEXORA_OPENCODE_TOKEN ?? undefined,
    opencodeManaged: bool(process.env.NEXORA_OPENCODE_MANAGED, true),
    opencodeRequestTimeoutMs: int(process.env.NEXORA_OPENCODE_TIMEOUT_MS, 180_000),
    opencodeProbeTimeoutMs: int(process.env.NEXORA_OPENCODE_PROBE_MS, 60_000),
    httpTimeoutMs: int(process.env.NEXORA_HTTP_TIMEOUT_MS, 20_000),
    httpUserAgent:
      process.env.NEXORA_HTTP_USER_AGENT ??
      'NexoraEntityBot/1.0 (+https://nexoraentity.com/bot; entity source inspection)',
    httpMaxBytes: int(process.env.NEXORA_HTTP_MAX_BYTES, 3_000_000),
    httpMaxRedirects: int(process.env.NEXORA_HTTP_MAX_REDIRECTS, 5),
    // `CRON_SECRET` is the name Vercel Cron uses: it sends `Authorization: Bearer $CRON_SECRET`
    // on every scheduled invocation. The platform-specific name is still accepted so a
    // self-hosted deployment can use it.
    cronSecret: process.env.NEXORA_CRON_SECRET ?? process.env.CRON_SECRET ?? 'nexora-entity-cron-development-secret',
    allowPlatformHostDeploy: bool(process.env.NEXORA_ALLOW_PLATFORM_HOST_DEPLOY, true),
    logLevel: (process.env.NEXORA_LOG_LEVEL as AppConfig['logLevel']) ?? 'info',
  };
}

let cached: AppConfig | undefined;

export function config(): AppConfig {
  if (!cached) cached = load();
  return cached;
}

/** Test helper: force a re-read of the environment. */
export function resetConfig(): void {
  cached = undefined;
}