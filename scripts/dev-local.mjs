/**
 * Start the web app in development with a real database.
 *
 * The web app runs with its working directory at `packages/web`, so a `.env.local` in the
 * repository root is not read by Next.js, and the app's built-in default points at a local
 * PostgreSQL that a fresh checkout does not have. This script closes that gap: it reads the
 * environment files at the repository root and hands them to the dev server as real environment
 * variables.
 *
 * Which database it uses:
 *
 *   - `.env.local.preview` is preferred, because it is the isolated preview database pulled from
 *     Vercel. Development therefore never writes to the production database by accident.
 *   - `.env.local` is the fallback, for a machine with a local PostgreSQL.
 *
 * Vercel cannot hand back secret values, so the pulled file contains `[SENSITIVE]` placeholders.
 * Those are filled in from `.env.local.secrets`, which is git-ignored, so a credential never
 * reaches the repository.
 *
 * Usage: node scripts/dev-local.mjs [--env preview] [--port 4311]
 */
import { spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);

function argValue(name, fallback) {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
}

const envChoice = argValue('--env', 'preview');
const port = argValue('--port', '4311');

/** Parse a `.env` file into a plain object. */
function parseEnvFile(file) {
  const out = {};
  if (!existsSync(file)) return out;
  for (const raw of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq < 0) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    out[key] = value;
  }
  return out;
}

const primaryFile =
  envChoice === 'preview' ? path.join(ROOT, '.env.local.preview') : path.join(ROOT, '.env.local');
const fallbackFile = envChoice === 'preview' ? path.join(ROOT, '.env.local') : path.join(ROOT, '.env.local.preview');
const secretsFile = path.join(ROOT, '.env.local.secrets');

const env = { ...parseEnvFile(fallbackFile), ...parseEnvFile(primaryFile) };
const secrets = parseEnvFile(secretsFile);

const missing = [];
for (const [key, value] of Object.entries(env)) {
  if (value === '[SENSITIVE]') {
    if (secrets[key]) env[key] = secrets[key];
    else missing.push(key);
  }
}

if (missing.length) {
  console.error(
    `Missing secret values for: ${missing.join(', ')}\n` +
      `Put them in ${path.relative(ROOT, secretsFile)} (one KEY=value per line). It is git-ignored.`,
  );
  process.exit(1);
}

if (!env.DATABASE_URL) {
  console.error(
    'No DATABASE_URL was found. Run "vercel env pull .env.local.preview --environment preview --yes" ' +
      'or put a database URL in .env.local.',
  );
  process.exit(1);
}

// Transaction poolers (PgBouncer) do not support channel binding; strip it so local dev connects.
if (env.DATABASE_URL) {
  const u = new URL(env.DATABASE_URL);
  if (u.searchParams.get('channel_binding') === 'require') {
    u.searchParams.delete('channel_binding');
    env.DATABASE_URL = u.toString();
  }
}

// The platform origin must point at the place the app is actually being served from, otherwise
// links the app generates point somewhere else.
env.NEXORA_PLATFORM_ORIGIN = env.NEXORA_PLATFORM_ORIGIN ?? `http://127.0.0.1:${port}`;
env.PORT = port;

/**
 * Deployment-time variables are removed.
 *
 * A pulled Vercel environment describes a deployment, not a development machine: `VERCEL=1` and
 * `TURBO_REMOTE_ONLY=true` make the dev server behave as though it were building for Vercel,
 * which breaks route resolution locally. They are read from the same file as the database URL
 * because Vercel writes them all there, so they have to be taken back out.
 */
for (const key of Object.keys(env)) {
  if (/^(VERCEL|TURBO|NX_DAEMON)/.test(key)) delete env[key];
}

const child = spawn('npm', ['run', 'dev', '--workspace', '@nexora/web'], {
  cwd: ROOT,
  stdio: 'inherit',
  shell: process.platform === 'win32',
  env: { ...process.env, ...env },
});

child.on('exit', (code) => process.exit(code ?? 0));
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => child.kill());
}
