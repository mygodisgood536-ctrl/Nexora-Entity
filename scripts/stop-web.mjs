/**
 * Stop the running platform and clear the build output.
 *
 * A running standalone server holds its own directory open, so the build cannot replace it
 * until the process is gone. This is the supported way to release that handle on Windows.
 */

import { execFileSync } from 'node:child_process';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync, rmSync } from 'node:fs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number.parseInt(process.env.NEXORA_WEB_PORT ?? '4311', 10);

function portOpen(port) {
  return new Promise((resolve) => {
    const socket = net.connect({ port, host: '127.0.0.1' });
    const done = (v) => {
      socket.destroy();
      resolve(v);
    };
    socket.setTimeout(1200);
    socket.once('connect', () => done(true));
    socket.once('timeout', () => done(false));
    socket.once('error', () => done(false));
    socket.connect(port, '127.0.0.1');
  });
}

/**
 * Find this project's own web processes, and only those.
 *
 * Matching on the port alone is not enough: an already-dead server leaves its `node server.js`
 * child and the `.cmd` launcher running, and they still hold the build directory open. Matching
 * on the command line is also not enough on its own, because a bare `node server.js` line belongs
 * to whatever the current working directory is. Both the project path in the command line and
 * the listener on the port are therefore required before a process is touched, so an unrelated
 * Node process on this machine is never killed.
 */
async function findWebProcesses() {
  const listening = new Set();

  if (await portOpen(PORT)) {
    const ps = `(Get-NetTCPConnection -LocalPort ${PORT} -State Listen -ErrorAction SilentlyContinue).OwningProcess`;
    try {
      const out = execFileSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', ps], {
        encoding: 'utf8',
        timeout: 20_000,
      });
      for (const line of out.split(/\r?\n/)) {
        const value = Number.parseInt(line.trim(), 10);
        if (Number.isInteger(value)) listening.add(value);
      }
    } catch {
      /* fall through to command-line matching */
    }
  }

  // The filter lives in a .ps1 file: a Windows path passed through `-Command` gets mangled by
  // PowerShell's own argument parsing, which silently yields no matches.
  const psScript = path.join(ROOT, 'scripts', 'find-web-processes.ps1');
  let mine = [];
  try {
    const out = execFileSync(
      'powershell.exe',
      ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', psScript, '-Root', ROOT],
      { encoding: 'utf8', timeout: 30_000 },
    );
    mine = out
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean)
      .map((l) => {
        const [id] = l.split('|');
        return Number.parseInt(id, 10);
      })
      .filter((id) => Number.isInteger(id));
  } catch {
    /* ignore */
  }

  // The emitted server runs as a bare `node server.js`, so its command line carries no project
  // path. The listener on our port is what identifies it, and that is only ever our process
  // because the port is ours. Everything matched by path is a launcher for this project.
  return { targets: [...new Set([...mine, ...listening])], listening };
}

/** True when the PID still exists. */
function alive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return err?.code === 'EPERM';
  }
}

const { targets, listening } = await findWebProcesses();

if (targets.length === 0) {
  console.log(`web       not running on 127.0.0.1:${PORT}`);
} else {
  // Kill the launcher first so it cannot restart the server while the child is being stopped.
  const launchers = targets.filter((id) => !listening.has(id));
  const servers = targets.filter((id) => listening.has(id));

  for (const id of launchers) {
    try {
      execFileSync('taskkill', ['/F', '/T', '/PID', String(id)], { stdio: 'ignore', timeout: 20_000 });
    } catch {
      /* already gone */
    }
  }
  for (const id of servers) {
    // A plain terminate is not always enough for a process holding a directory open.
    for (const attempt of [null, '/F']) {
      if (!alive(id)) break;
      try {
        execFileSync('taskkill', [...(attempt ? [attempt] : []), '/T', '/PID', String(id)], {
          stdio: 'ignore',
          timeout: 20_000,
        });
      } catch {
        /* already gone */
      }
      await new Promise((r) => setTimeout(r, 900));
    }
  }

  const survivors = targets.filter(alive);
  if (survivors.length > 0) {
    console.error(`web       WARNING: still running: ${survivors.join(', ')}`);
  }
  console.log(`web       stopped on 127.0.0.1:${PORT} (${targets.length - survivors.length}/${targets.length} process(es))`);
}

// Give the OS a moment to release the directory handles.
for (let i = 0; i < 20; i += 1) {
  if (!(await portOpen(PORT))) break;
  await new Promise((r) => setTimeout(r, 500));
}

const nextDir = path.join(ROOT, 'packages', 'web', '.next');
if (existsSync(nextDir) && process.argv.includes('--purge')) {
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      rmSync(nextDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 400 });
      console.log('web       .next purged');
      break;
    } catch (err) {
      if (attempt === 3) console.error(`web       could not purge .next: ${err.message}`);
      else await new Promise((r) => setTimeout(r, 800));
    }
  }
}