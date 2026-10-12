/**
 * Copy static assets into the Next.js `output: standalone` tree.
 *
 * `output: 'standalone'` emits a self-contained server with its own minimal `node_modules`, but
 * it deliberately does NOT copy `.next/static` or `public` into that tree. The emitted server
 * resolves `/_next/static/...` relative to its own location, so without this step every
 * stylesheet and client chunk 404s in production — the application serves unstyled HTML.
 *
 * This only reproduces the correct behaviour; it is not a workaround, it is the missing half of
 * the standalone output contract.
 */

import { cpSync, existsSync, mkdirSync, rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const WEB = path.join(ROOT, 'packages', 'web');
const NEXT = path.join(WEB, '.next');

// The app lives at packages/web inside an npm workspace, so the standalone server is emitted at
// .next/standalone/packages/web/server.js rather than at the top of the standalone tree.
const STANDALONE = path.join(NEXT, 'standalone', 'packages', 'web');

if (!existsSync(STANDALONE)) {
  console.error('[standalone-assets] no standalone output found; was `next build` run?');
  process.exit(1);
}

const pairs = [
  { from: path.join(NEXT, 'static'), to: path.join(STANDALONE, '.next', 'static') },
  { from: path.join(WEB, 'public'), to: path.join(STANDALONE, 'public') },
];

let copied = 0;
for (const { from, to } of pairs) {
  if (!existsSync(from)) continue;
  mkdirSync(path.dirname(to), { recursive: true });
  rmSync(to, { recursive: true, force: true });
  cpSync(from, to, { recursive: true });
  copied += 1;
  console.log(`[standalone-assets] ${path.relative(WEB, from)} -> ${path.relative(WEB, to)}`);
}

if (copied === 0) {
  console.error('[standalone-assets] nothing copied: expected .next/static to exist');
  process.exit(1);
}

console.log(`[standalone-assets] copied ${copied} asset tree(s) into the standalone build`);