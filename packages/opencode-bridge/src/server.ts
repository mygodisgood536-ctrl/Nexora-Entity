/**
 * OpenCode HTTP client — the only half of the bridge the web application may import.
 *
 * Nexora Entity does not talk to model providers directly. OpenCode is the provider/model
 * bridge: it exposes its own HTTP API and is the only source of provider/model availability.
 * Nothing here hard-codes a provider list.
 *
 * IMPORTANT — this module deliberately does not spawn processes.
 *
 * It used to also supervise a locally-spawned `opencode serve`. That made `node:child_process`
 * part of the Next.js server-component graph, which made Turbopack trace and include the entire
 * project in the build output, and it hard-wired the platform to a local machine. Both are
 * wrong for a hosted deployment.
 *
 * The split is:
 *   - `client.ts`     — attach-only HTTP client. Safe to import anywhere, including the web app.
 *   - `supervisor.ts` — spawns a local OpenCode process. Used only by local development scripts.
 *
 * `ensureReady()` here therefore *attaches* to a running OpenCode and reports honestly when one
 * is not reachable. In local development `npm run services` starts OpenCode; in a hosted
 * deployment a cloud-hosted bridge is configured with `NEXORA_OPENCODE_HOST`/`_PORT`. Neither
 * requires this module to know how the process was started.
 */

import { config } from '@nexora/core/config';
import { createLogger, ConfigurationError } from '@nexora/core';
import { consoleBase, fetchConsoleConfig, isConsoleTransport } from './console';

const log = createLogger('opencode');

export type BridgeState = 'stopped' | 'starting' | 'ready' | 'unavailable';

/**
 * Module state is held on `globalThis` for the same reason the database pool is
 * (`packages/db/src/pool.ts`): a production Next build emits one module instance per route
 * chunk, so module-level state would be duplicated per route and two chunks could each believe
 * they owned the bridge.
 */
interface BridgeModuleState {
  state: BridgeState;
  version: string | null;
  lastError: string | null;
}

const KEY = Symbol.for('nexora.entity.opencode.bridge');
const holder = globalThis as unknown as Record<symbol, BridgeModuleState | undefined>;
const mod: BridgeModuleState = (holder[KEY] ??= {
  state: 'stopped',
  version: null,
  lastError: null,
});

export function baseUrl(): string {
  const cfg = config();
  const scheme = cfg.opencodeUrl?.startsWith('https://') ? 'https' : 'http';
  return cfg.opencodeUrl ?? `${scheme}://${cfg.opencodeHost}:${cfg.opencodePort}`;
}

export function getState(): BridgeState {
  return mod.state;
}

export function getVersion(): string | null {
  return mod.version;
}

export function getLastError(): string | null {
  return mod.lastError;
}

/**
 * The headers every request to the bridge must carry.
 *
 * A hosted bridge is expected to require credentials; local development usually does not. The
 * token is applied centrally so that no call site can forget it — provider discovery, session
 * creation and message sending all need the same credential as the health probe, and a bridge that
 * requires a bearer token rejects the rest of its API when they arrive unauthenticated.
 */
export function authHeaders(): Record<string, string> {
  const token = config().opencodeToken;
  return token ? { authorization: `Bearer ${token}` } : {};
}

export async function httpGet(
  pathname: string,
  timeoutMs: number,
  headers: Record<string, string> = {},
): Promise<{ status: number; body: string } | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${baseUrl()}${pathname}`, {
      signal: controller.signal,
      headers: { accept: 'application/json', ...authHeaders(), ...headers },
    });
    const body = await res.text();
    return { status: res.status, body };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export interface BridgeHealth {
  healthy: boolean;
  version: string | null;
  managed: boolean;
  pid: number | null;
  detail: string;
}

/** Health probe. Never throws — the caller decides how to surface a problem. */
export async function health(): Promise<BridgeHealth> {
  // The Console transport is probed with the workspace configuration, which is the endpoint that
  // actually answers for it. The serve-server transport keeps its own liveness route.
  if (isConsoleTransport()) {
    try {
      const workspace = await fetchConsoleConfig(20_000);
      const providers = Object.keys(workspace.providers ?? {}).length;
      mod.state = 'ready';
      mod.version = mod.version ?? 'console';
      return {
        healthy: true,
        version: mod.version,
        managed: false,
        pid: null,
        detail: `OpenCode Console reachable at ${consoleBase()} (${providers} provider(s))`,
      };
    } catch (err) {
      mod.state = 'unavailable';
      mod.lastError = err instanceof Error ? err.message : String(err);
      return {
        healthy: false,
        version: mod.version,
        managed: false,
        pid: null,
        detail: `OpenCode Console did not respond at ${consoleBase()}: ${mod.lastError}`,
      };
    }
  }

  const res = await httpGet('/global/health', 4000);
  if (res && res.status === 200) {
    try {
      const parsed = JSON.parse(res.body) as { healthy?: boolean; version?: string };
      mod.state = 'ready';
      mod.version = parsed.version ?? mod.version;
      return {
        healthy: parsed.healthy !== false,
        version: mod.version,
        managed: false,
        pid: null,
        detail: `OpenCode ${mod.version ?? ''} reachable at ${baseUrl()}`,
      };
    } catch {
      /* fall through to the unhealthy result below */
    }
  }
  return {
    healthy: false,
    version: mod.version,
    managed: false,
    pid: null,
    detail: mod.lastError ?? `OpenCode did not respond at ${baseUrl()}`,
  };
}

/**
 * Ensure OpenCode is reachable by attaching to it.
 *
 * This never starts a process. When nothing is listening it throws a ConfigurationError that
 * says exactly how to make it reachable, which is what lets the UI show an honest pending state
 * instead of pretending an AI provider exists.
 */
export async function ensureReady(): Promise<BridgeHealth> {
  const h = await health();
  if (h.healthy) {
    if (mod.state !== 'ready') {
      mod.state = 'ready';
      log.info('attached to OpenCode server', { url: baseUrl(), version: mod.version });
    }
    return h;
  }
  mod.state = 'unavailable';
  mod.lastError = h.detail;
  throw ConfigurationError(
    isConsoleTransport()
      ? `Nexora Entity could not reach the OpenCode Console at ${consoleBase()}.`
      : `Nexora Entity could not reach the OpenCode AI bridge at ${baseUrl()}.`,
    cfgStartHint(),
  );
}

function cfgStartHint(): string {
  const cfg = config();
  if (isConsoleTransport()) {
    return 'The OpenCode Console is configured but did not answer. Check that NEXORA_OPENCODE_URL points at the Console and that NEXORA_OPENCODE_TOKEN is a valid service-account key.';
  }
  if (cfg.opencodeManaged) {
    return 'Locally, start it with `npm run services`. On a hosted deployment, set NEXORA_OPENCODE_URL (and NEXORA_OPENCODE_TOKEN if the bridge requires authentication) to the cloud-hosted bridge.';
  }
  return 'Set NEXORA_OPENCODE_HOST and NEXORA_OPENCODE_PORT (or NEXORA_OPENCODE_URL) to the machine running OpenCode.';
}

export async function getVersionString(): Promise<string | null> {
  if (mod.version) return mod.version;
  const h = await health();
  return h.version;
}