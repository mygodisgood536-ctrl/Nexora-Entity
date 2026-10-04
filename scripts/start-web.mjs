/**
 * Start the built platform on a fixed port for verification, detached from this shell.
 *
 * A directly spawned server inherits this console and dies with it, so it is launched through
 * WMI and its output is captured to a log the caller can inspect.
 */

import { execFileSync, spawn } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const LOG_DIR = path.join(ROOT, '.pg', 'logs');
const PORT = Number.parseInt(process.env.NEXORA_WEB_PORT ?? '4311', 10);
const LOG = path.join(LOG_DIR, 'web-platform.log');

mkdirSync(LOG_DIR, { recursive: true });

/**
 * Is the platform answering HTTP?
 *
 * Keep-alive is disabled and the body is drained: a lingering keep-alive socket keeps a libuv
 * handle open, and `process.exit` with a handle still closing trips an assertion on Windows that
 * makes this script appear to crash after it has already succeeded.
 */
async function httpOk(pathname = '/') {
  try {
    const res = await fetch(`http://127.0.0.1:${PORT}${pathname}`, {
      headers: { connection: 'close' },
      signal: AbortSignal.timeout(5000),
    });
    await res.arrayBuffer();
    return { status: res.status, ok: res.ok };
  } catch (err) {
    return { status: 0, ok: false, error: String(err) };
  }
}

/**
 * Exit cleanly once the fetch client has released its sockets.
 *
 * Calling process.exit while undici still holds a closing handle trips a libuv assertion on
 * Windows (exit code 0xC0000409), which reports as a crash even though the script succeeded.
 */
async function exitCleanly(code) {
  try {
    const dispatcher = globalThis[Symbol.for('undici.globalDispatcher.1')];
    await dispatcher?.close();
  } catch {
    /* nothing to close */
  }
  await new Promise((r) => setTimeout(r, 250));
  process.exit(code);
}

const existing = await httpOk();
if (existing.ok) {
  console.log(`web       already serving on 127.0.0.1:${PORT} (HTTP ${existing.status})`);
  await exitCleanly(0);
}

const webDir = path.join(ROOT, 'packages', 'web');
if (!existsSync(path.join(webDir, '.next', 'BUILD_ID'))) {
  console.error(`web       NO BUILD. Run: npm run build`);
  await exitCleanly(1);
}

// Next 16 `output: standalone` builds are served by the emitted server.js, not `next start`.
// Because the Next app lives at packages/web inside an npm workspace, the standalone output is
// rooted at packages/web/.next/standalone/packages/web/server.js rather than at the top of the
// standalone tree.
const standaloneRoot = path.join(webDir, '.next', 'standalone');
const standaloneServer = path.join(standaloneRoot, 'packages', 'web', 'server.js');

if (!existsSync(standaloneServer)) {
  console.error(`web       NO STANDALONE BUILD at ${standaloneServer}. Run: npm run build`);
  await exitCleanly(1);
}

// The launch lives in a .cmd file: WMI will not reliably execute a command line carrying the
// nested quoting and chained `set` calls this requires.
const launcher = path.join(ROOT, 'scripts', 'start-web.cmd');
const commandLine = `"${launcher}"`;

let method = 'spawn';
try {
  const ps = `$c = New-CimInstance -ClassName Win32_Process -ClientOnly; Invoke-CimMethod -InputObject $c -MethodName Create -Arguments @{ CommandLine = '${commandLine.replace(/'/g, "''")}' } | Out-Null`;
  execFileSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', ps], {
    stdio: 'ignore',
    timeout: 30_000,
  });
  method = 'wmi';
} catch {
  const child = spawn(commandLine, { detached: true, stdio: 'ignore', windowsHide: true, shell: true });
  child.unref();
}

console.log(`web       starting (${method}) on 127.0.0.1:${PORT}`);

for (let i = 0; i < 90; i += 1) {
  await new Promise((r) => setTimeout(r, 1000));
  const health = await httpOk();
  if (health.ok) {
    console.log(`web       ready on 127.0.0.1:${PORT} (HTTP ${health.status})`);
    await exitCleanly(0);
  }
}

console.error(`web       FAILED to start. See ${LOG}`);
await exitCleanly(1);