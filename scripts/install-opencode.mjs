/**
 * Install the OpenCode CLI that Nexora Entity uses as its provider/model bridge.
 *
 * Idempotent. Verifies the binary actually runs. Fails loudly if it cannot be installed —
 * the platform must never pretend OpenCode is available when it is not.
 */
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');

function localBinary() {
  const p = path.join(root, 'node_modules', 'opencode-ai', 'bin', process.platform === 'win32' ? 'opencode.exe' : 'opencode');
  return existsSync(p) ? p : null;
}

const existing = localBinary();
if (existing) {
  const v = execFileSync(existing, ['--version'], { encoding: 'utf8' }).trim();
  console.log(`OpenCode already installed at ${existing} (v${v})`);
  process.exit(0);
}

console.log('Installing opencode-ai into the project…');
execFileSync('npm', ['install', 'opencode-ai@latest', '--no-audit', '--no-fund', '--workspace', '@nexora/opencode-bridge'], {
  cwd: root,
  stdio: 'inherit',
});

const binary = localBinary();
if (!binary) {
  console.error('opencode-ai installed but its binary was not found.');
  console.error('Check that the package postinstall script ran (npm approve-scripts opencode-ai).');
  process.exit(1);
}
const v = execFileSync(binary, ['--version'], { encoding: 'utf8' }).trim();
console.log(`OpenCode ready at ${binary} (v${v})`);