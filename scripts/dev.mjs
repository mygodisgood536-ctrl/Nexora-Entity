/**
 * Start the platform in development mode.
 *
 * The previous `npm run dev` pointed at this file, but the file did not exist, so the script
 * failed outright. Development does not need the detached-WMI machinery that `start-web.mjs`
 * uses for the built server: `next dev` is attached to the terminal on purpose, so Ctrl+C stops
 * it and hot reload works.
 *
 * Note that the guided entity journey additionally needs PostgreSQL. Run `npm run db:start`
 * first; without a database the account, entity and readiness screens cannot load and will
 * report a connection error rather than pretending to work.
 */

import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const child = spawn('npm', ['run', 'dev', '--workspace', '@nexora/web'], {
  cwd: ROOT,
  stdio: 'inherit',
  shell: process.platform === 'win32',
});

child.on('exit', (code) => process.exit(code ?? 0));

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => child.kill());
}