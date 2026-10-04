/**
 * OpenCode server supervisor.
 *
 * Nexora Entity does not talk to model providers directly. OpenCode is the provider/model
 * bridge: it is started (or attached to), exposes its real HTTP API, and is the only source
 * of provider/model availability. Nothing here hard-codes a provider list.
 */

import { spawn, type ChildProcess } from 'node:child_process';
import { createServer } from 'node:net';
import { accessSync, constants, existsSync } from 'node:fs';
import path from 'node:path';
import { config } from '@nexora/core/config';
import { createLogger, NexoraError, ConfigurationError } from '@nexora/core';

const log = createLogger('opencode');

export type BridgeState = 'stopped' | 'starting' | 'ready' | 'unavailable';

let child: ChildProcess | undefined;
let state: BridgeState = 'stopped';
let version: string | null = null;
let startPromise: Promise<void> | null = null;
let lastError: string | null = null;

/** Locate the OpenCode binary: explicit env, project install, then PATH. */
export function resolveOpencodeBinary(): string {
  const cfg = config();
  if (cfg.opencodeBinary) {
    // Resolved from configuration at runtime; tracing is declared explicitly where needed.
    if (existsSync(/* turbopackIgnore: true */ cfg.opencodeBinary)) return cfg.opencodeBinary;
    throw ConfigurationError(
      `The configured OpenCode binary does not exist at ${cfg.opencodeBinary}.`,
      'Set OPENCODE_BIN to a valid OpenCode executable, or run: npm run opencode:install',
    );
  }
  const candidates = [
    path.join(cfg.repoRoot, 'node_modules', 'opencode-ai', 'bin', 'opencode.exe'),
    path.join(cfg.repoRoot, 'node_modules', 'opencode-ai', 'bin', 'opencode'),
    path.join(cfg.repoRoot, 'node_modules', '.bin', 'opencode'),
  ];
  for (const c of candidates) if (existsSync(/* turbopackIgnore: true */ c)) return c;
  throw ConfigurationError(
    'OpenCode is not installed in this project, so Nexora Entity cannot discover AI providers.',
    'Run: npm run opencode:install',
  );
}

export function baseUrl(): string {
  const cfg = config();
  return `http://${cfg.opencodeHost}:${cfg.opencodePort}`;
}

export function getState(): BridgeState {
  return state;
}

export function getVersion(): string | null {
  return version;
}

export function getLastError(): string | null {
  return lastError;
}

/** Is something already serving the configured OpenCode port? */
async function portOpen(timeoutMs = 1200): Promise<boolean> {
  const cfg = config();
  return new Promise((resolve) => {
    let settled = false;
    const finish = (v: boolean) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(v);
    };
    const socket = createServer();
    const timer = setTimeout(() => {
      socket.close();
      finish(false);
    }, timeoutMs);
    socket.once('error', () => finish(false));
    socket.once('listening', () => socket.close(() => finish(true)));
    socket.listen(cfg.opencodePort, cfg.opencodeHost);
  });
}

async function httpGet(pathname: string, timeoutMs: number): Promise<{ status: number; body: string } | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${baseUrl()}${pathname}`, {
      signal: controller.signal,
      headers: { accept: 'application/json' },
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
  const res = await httpGet('/global/health', 4000);
  if (res && res.status === 200) {
    try {
      const parsed = JSON.parse(res.body) as { healthy?: boolean; version?: string };
      state = 'ready';
      version = parsed.version ?? version;
      return {
        healthy: parsed.healthy !== false,
        version,
        managed: Boolean(child && !child.killed),
        pid: child?.pid ?? null,
        detail: `OpenCode ${version ?? ''} reachable at ${baseUrl()}`,
      };
    } catch {
      /* fall through */
    }
  }
  return {
    healthy: false,
    version,
    managed: Boolean(child && !child.killed),
    pid: child?.pid ?? null,
    detail: lastError ?? `OpenCode did not respond at ${baseUrl()}`,
  };
}

/**
 * Ensure OpenCode is reachable. Attaches to an existing server when one is present,
 * otherwise starts a managed one. Idempotent and concurrency-safe.
 */
export async function ensureReady(): Promise<BridgeHealth> {
  const cfg = config();
  const existing = await health();
  if (existing.healthy) {
    if (state !== 'ready') {
      state = 'ready';
      log.info('attached to running OpenCode server', { url: baseUrl(), version });
    }
    return existing;
  }
  if (!cfg.opencodeManaged) {
    throw ConfigurationError(
      `Nexora Entity is configured to use an external OpenCode server at ${baseUrl()}, but it is not responding.`,
      'Start OpenCode with `opencode serve --port 4137`, or set NEXORA_OPENCODE_MANAGED=true so Nexora Entity starts it.',
    );
  }
  if (startPromise) {
    await startPromise;
    return health();
  }
  startPromise = startManaged();
  try {
    await startPromise;
  } finally {
    startPromise = null;
  }
  return health();
}

async function startManaged(): Promise<void> {
  const cfg = config();
  state = 'starting';
  const binary = resolveOpencodeBinary();
  log.info('starting managed OpenCode server', { binary, port: cfg.opencodePort });

  const logPath = path.join(cfg.repoRoot, '.pg', 'logs', 'opencode-bridge.log');
  let stdoutFd: number | undefined;
  try {
    const { openSync } = await import('node:fs');
    stdoutFd = openSync(logPath, 'a');
  } catch {
    stdoutFd = undefined;
  }

  const args = [
    'serve',
    '--port',
    String(cfg.opencodePort),
    '--hostname',
    cfg.opencodeHost,
    '--log-level',
    cfg.logLevel === 'debug' ? 'DEBUG' : cfg.logLevel === 'warn' ? 'WARN' : 'INFO',
  ];

  child = spawn(binary, args, {
    cwd: cfg.repoRoot,
    env: { ...process.env, NO_COLOR: '1' },
    windowsHide: true,
    detached: false,
    stdio: ['ignore', stdoutFd ?? 'ignore', stdoutFd ?? 'ignore'],
  });

  child.on('exit', (code, signal) => {
    log.warn('managed OpenCode server exited', { code, signal });
    state = 'stopped';
    child = undefined;
  });
  child.on('error', (err) => {
    lastError = err.message;
    log.error('failed to spawn OpenCode', { message: err.message });
  });

  // Poll for readiness rather than trusting a single attempt.
  const deadline = Date.now() + 45_000;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 400));
    const h = await health();
    if (h.healthy) {
      state = 'ready';
      log.info('managed OpenCode server ready', { version, url: baseUrl() });
      return;
    }
  }
  state = 'unavailable';
  lastError = lastError ?? 'OpenCode did not become ready within 45s';
  throw new NexoraError({
    code: 'ai_provider_bridge_unavailable',
    domain: 'ai_provider',
    message:
      'Nexora Entity could not start the OpenCode AI bridge, so no AI provider or model is available right now. Your information is safe.',
    detail: lastError,
    retryable: true,
    remediation: [
      { kind: 'retry', label: 'Try again', primary: true },
      { kind: 'contact_support', label: 'Get help' },
    ],
  });
}

export async function getVersionString(): Promise<string | null> {
  if (version) return version;
  const h = await health();
  return h.version;
}

export async function stopManaged(): Promise<void> {
  if (child && !child.killed) {
    child.kill();
    child = undefined;
  }
  state = 'stopped';
}

/** Used by scripts that need the binary on PATH-like behaviour. */
export function binaryIsExecutable(binary: string): boolean {
  try {
    accessSync(binary, constants.X_OK);
    return true;
  } catch {
    return existsSync(binary);
  }
}