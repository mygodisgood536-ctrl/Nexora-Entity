/**
 * Local OpenCode process supervisor — development tooling only.
 *
 * This module spawns `opencode serve` as a child process. It is intentionally NOT re-exported
 * from `index.ts`, so the web application cannot pull `node:child_process` into its server
 * graph. Only local scripts should import it:
 *
 *   node --import tsx scripts/check-bridge.ts
 *
 * A hosted deployment never uses this file. There, OpenCode runs as its own cloud service and
 * the application attaches to it over HTTP (see `client.ts`).
 */

import { spawn, type ChildProcess } from 'node:child_process';
import { accessSync, constants, existsSync } from 'node:fs';
import path from 'node:path';
import { config } from '@nexora/core/config';
import { createLogger, NexoraError, ConfigurationError } from '@nexora/core';
import { baseUrl, health, type BridgeHealth } from './server';

const log = createLogger('opencode:supervisor');

let child: ChildProcess | undefined;
let startPromise: Promise<void> | null = null;

/** Locate the OpenCode binary: explicit env, project install, then PATH. */
export function resolveOpencodeBinary(): string {
  const cfg = config();
  if (cfg.opencodeBinary) {
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

/**
 * Start a managed local OpenCode server and wait for it to answer.
 *
 * Concurrency-safe: concurrent callers share one start attempt rather than racing to bind the
 * same port.
 */
export async function startManaged(): Promise<void> {
  if (startPromise) return startPromise;
  startPromise = doStart();
  try {
    await startPromise;
  } finally {
    startPromise = null;
  }
}

async function doStart(): Promise<void> {
  const cfg = config();
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

  child = spawn(/* turbopackIgnore: true */ binary, args, {
    cwd: cfg.repoRoot,
    env: { ...process.env, NO_COLOR: '1' },
    windowsHide: true,
    detached: false,
    stdio: ['ignore', stdoutFd ?? 'ignore', stdoutFd ?? 'ignore'],
  });

  child.on('exit', (code, signal) => {
    log.warn('managed OpenCode server exited', { code, signal });
    child = undefined;
  });
  child.on('error', (err) => {
    log.error('failed to spawn OpenCode', { message: err.message });
  });

  // Poll for readiness rather than trusting a single attempt.
  const deadline = Date.now() + 45_000;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 400));
    const h: BridgeHealth = await health();
    if (h.healthy) {
      log.info('managed OpenCode server ready', { version: h.version, url: baseUrl() });
      return;
    }
  }
  throw new NexoraError({
    code: 'ai_provider_bridge_unavailable',
    domain: 'ai_provider',
    message:
      'Nexora Entity could not start the OpenCode AI bridge, so no AI provider or model is available right now. Your information is safe.',
    detail: 'OpenCode did not become ready within 45s.',
    retryable: true,
    remediation: [
      { kind: 'retry', label: 'Try again', primary: true },
      { kind: 'contact_support', label: 'Get help' },
    ],
  });
}

export async function stopManaged(): Promise<void> {
  if (child && !child.killed) {
    child.kill();
    child = undefined;
  }
}

/** Used by scripts that need to confirm a resolved binary can actually run. */
export function binaryIsExecutable(binary: string): boolean {
  try {
    accessSync(binary, constants.X_OK);
    return true;
  } catch {
    return existsSync(binary);
  }
}