/**
 * Ensures Nexora Entity's local services are running: PostgreSQL and the OpenCode bridge.
 *
 * Both are started detached from this process so they survive the lifetime of the shell that
 * invoked them. Safe to run repeatedly.
 *
 * Usage: node scripts/ensure-services.mjs [--quiet]
 */
import { spawn } from 'node:child_process';
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const QUIET = process.argv.includes('--quiet');

const say = (...args) => {
  if (!QUIET) console.log(...args);
};

function portOpen(port, host = '127.0.0.1', timeoutMs = 1200) {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    let settled = false;
    const done = (v) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(v);
    };
    socket.setTimeout(timeoutMs);
    socket.once('connect', () => done(true));
    socket.once('timeout', () => done(false));
    socket.once('error', () => done(false));
    socket.connect(port, host);
  });
}

/**
 * Launch a detached, console-free process on Windows.
 *
 * `spawn(..., { detached: true })` still leaves the child attached to this process tree: when the
 * launching shell exits, the child receives console-close (0xC000013A) and PostgreSQL backends
 * fail with 0xC0000142. WMI `Win32_Process.Create` reparents the child to the WMI provider host,
 * so it survives independently. That is why PostgreSQL runs from a scheduled task and OpenCode is
 * launched here.
 */
function launchDetached(commandLine) {
  try {
    const ps = `\$c = New-CimInstance -ClassName Win32_Process -ClientOnly; Invoke-CimMethod -InputObject \$c -MethodName Create -Arguments @{ CommandLine = '${commandLine.replace(/'/g, "''")}' } | Out-Null`;
    execFileSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', ps], {
      stdio: 'ignore',
      timeout: 30_000,
    });
    return 'wmi';
  } catch {
    const child = spawn(commandLine, { detached: true, stdio: 'ignore', windowsHide: true, shell: true });
    child.unref();
    return 'spawn';
  }
}

const TASK_NAME = 'NexoraEntityPostgres';

/** A listening port is not enough: Postgres opens the port before recovery finishes. */
async function postgresAcceptsConnections(port) {
  if (!(await portOpen(port))) return false;
  try {
    const { Client } = await import('pg');
    const c = new Client({
      host: '127.0.0.1',
      port,
      user: process.env.NEXORA_PG_USER ?? 'nexora_entity',
      password: process.env.NEXORA_PG_PASSWORD ?? 'nexora_entity',
      database: process.env.NEXORA_PG_DATABASE ?? 'nexora_entity_dev',
      connectionTimeoutMillis: 4000,
    });
    await c.connect();
    await c.query('SELECT 1');
    await c.end();
    return true;
  } catch {
    return false;
  }
}

async function ensurePostgres() {
  const port = Number.parseInt(process.env.NEXORA_PG_PORT ?? '5433', 10);
  if (await postgresAcceptsConnections(port)) {
    say(`postgres  already accepting connections on 127.0.0.1:${port}`);
    return true;
  }

  const pgBin = path.join(root, '.pg', '16', 'bin', process.platform === 'win32' ? 'postgres.exe' : 'postgres');
  const data = path.join(root, '.pg', 'data');
  if (!existsSync(pgBin) || !existsSync(path.join(data, 'PG_VERSION'))) {
    say(`postgres  NOT INITIALISED. Run: npm run db:start`);
    return false;
  }

  const logDir = path.join(root, '.pg', 'logs');
  const log = path.join(logDir, 'postgres.log');
  execFileSync('powershell.exe', ['-NoProfile', '-Command', `New-Item -ItemType Directory -Force -Path '${logDir}' | Out-Null`], {
    stdio: 'ignore',
  });

  // A scheduled task runs in its own session with no console, which is what keeps the
  // postmaster alive after the shell that launched it exits. A directly spawned postmaster
  // receives console control events and dies with STATUS_CONTROL_C_EXIT (0xC000013A), and its
  // backends then fail with STATUS_DLL_INIT_FAILED (0xC0000142).
  //
  // The task is registered once and only ever started: re-registering a running task tears the
  // postmaster down and forces a crash-recovery cycle on every service check.
  const ps = [
    `$ErrorActionPreference = 'Stop'`,
    `$existing = Get-ScheduledTask -TaskName '${TASK_NAME}' -ErrorAction SilentlyContinue`,
    `if (-not $existing) {`,
    `  $action = New-ScheduledTaskAction -Execute '${pgBin}' -Argument '-D "${data}" -p ${port}'`,
    `  $settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit ([TimeSpan]::Zero) -MultipleInstances IgnoreNew`,
    `  $principal = New-ScheduledTaskPrincipal -UserId $env:USERNAME -LogonType Interactive -RunLevel Limited`,
    `  Register-ScheduledTask -TaskName '${TASK_NAME}' -Action $action -Settings $settings -Principal $principal -Force | Out-Null`,
    `}`,
    `Start-ScheduledTask -TaskName '${TASK_NAME}'`,
  ].join('; ');

  let started = false;
  try {
    execFileSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', ps], {
      stdio: 'ignore',
      timeout: 60_000,
    });
    started = true;
  } catch {
    // Fall back to a detached spawn if Task Scheduler is unavailable.
    const pgCtl = path.join(root, '.pg', '16', 'bin', process.platform === 'win32' ? 'pg_ctl.exe' : 'pg_ctl');
    launchDetached(`"${pgCtl}" -D "${data}" -l "${log}" -o "-p ${port}" -w start`);
    started = true;
  }
  say(`postgres  starting via scheduled task '${TASK_NAME}'${started ? '' : ' (failed)'}`);

  for (let i = 0; i < 60; i += 1) {
    await new Promise((r) => setTimeout(r, 1000));
    if (await postgresAcceptsConnections(port)) {
      say(`postgres  ready on 127.0.0.1:${port}`);
      return true;
    }
  }
  say(`postgres  FAILED to start. See ${log}`);
  return false;
}

async function ensureOpencode() {
  const port = Number.parseInt(process.env.NEXORA_OPENCODE_PORT ?? '4137', 10);
  const probe = async () => {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 3000);
      const res = await fetch(`http://127.0.0.1:${port}/global/health`, { signal: controller.signal });
      clearTimeout(timer);
      if (!res.ok) return null;
      return await res.json();
    } catch {
      return null;
    }
  };

  const existing = await probe();
  if (existing) {
    say(`opencode  already serving on 127.0.0.1:${port} (v${existing.version ?? '?'})`);
    return true;
  }

  const binary =
    process.env.OPENCODE_BIN ??
    path.join(
      root,
      'node_modules',
      'opencode-ai',
      'bin',
      process.platform === 'win32' ? 'opencode.exe' : 'opencode',
    );
  if (!existsSync(binary)) {
    say(`opencode  BINARY MISSING at ${binary}. Run: npm run opencode:install`);
    return false;
  }
  const logDir = path.join(root, '.pg', 'logs');
  execFileSync('powershell.exe', ['-NoProfile', '-Command', `New-Item -ItemType Directory -Force -Path '${logDir}' | Out-Null`], {
    stdio: 'ignore',
  });

  // Started through Task Scheduler, for the same reason PostgreSQL is: a console-hosted process
  // receives CTRL_C_EVENT when its console closes. The PowerShell script also guarantees the task
  // is registered once and only ever started.
  const psScript = path.join(root, 'scripts', 'start-opencode.ps1');
  let method = 'scheduled task';
  try {
    execFileSync(
      'powershell.exe',
      ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', psScript, '-Root', root, '-Port', String(port)],
      { stdio: 'ignore', timeout: 60_000 },
    );
  } catch {
    // Fall back to a detached launch if Task Scheduler is unavailable.
    method = launchDetached(`"${path.join(root, 'scripts', 'start-opencode.cmd')}"`);
  }
  say(`opencode  starting (${method})`);

  for (let i = 0; i < 60; i += 1) {
    await new Promise((r) => setTimeout(r, 1000));
    const h = await probe();
    if (h) {
      say(`opencode  ready on 127.0.0.1:${port} (v${h.version ?? '?'})`);
      return true;
    }
  }
  say('opencode  FAILED to start. Check .pg/logs/opencode-bridge.log');
  return false;
}

const pg = await ensurePostgres();
const oc = await ensureOpencode();
process.exit(pg && oc ? 0 : 1);
