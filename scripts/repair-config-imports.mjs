/**
 * Repair the mixed-import rewrite, line by line.
 *
 * When a file imported `config` together with other symbols from the shared `@nexora/core`
 * barrel, the earlier pass duplicated those other symbols into the `@nexora/core/config`
 * statement. For each adjacent pair of single-line imports, keep only `config` on the
 * server-only subpath and leave the remaining symbols on the barrel.
 */
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(process.cwd());
const SKIP = /node_modules|\.next|\.pg|storage|dist|coverage/;
const EXTS = ['.ts', '.tsx', '.mjs', '.js'];

function* walk(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (SKIP.test(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(full);
    else if (EXTS.includes(path.extname(entry.name))) yield full;
  }
}

const CONFIG_LINE = /^import(\s+type)?\s*\{([^}]*)\}\s*from\s*'@nexora\/core\/config';$/;
const BARREL_LINE = /^import(\s+type)?\s*\{([^}]*)\}\s*from\s*'@nexora\/core';$/;

const split = (list) =>
  list
    .split(',')
    .map((n) => n.trim())
    .filter(Boolean);

let repaired = 0;
const unresolved = [];

for (const root of ['packages', 'scripts']) {
  let entries;
  try {
    entries = [...walk(path.join(ROOT, root))];
  } catch {
    continue;
  }

  for (const file of entries) {
    const original = readFileSync(file, 'utf8');
    if (!original.includes('@nexora/core/config')) continue;

    const lines = original.split('\n');
    const out = [];
    let changed = false;

    for (let i = 0; i < lines.length; i += 1) {
      const here = CONFIG_LINE.exec(lines[i].trimEnd() ?? '');
      const next = i + 1 < lines.length ? BARREL_LINE.exec((lines[i + 1] ?? '').trimEnd()) : null;

      if (here && next && (here[1]?.trim() ?? '') === (next[1]?.trim() ?? '')) {
        const cfgNames = split(here[2] ?? '');
        const barrelNames = split(next[2] ?? '');
        const others = cfgNames.filter((n) => !/^config$/.test(n));
        const cfgOnly = cfgNames.filter((n) => /^config$/.test(n));

        const isDuplicate =
          others.length > 0 &&
          barrelNames.length === others.length &&
          others.every((n, idx) => n === barrelNames[idx]);

        if (isDuplicate) {
          const typeOnly = here[1]?.trim() === 'type' ? ' type' : '';
          out.push(`import${typeOnly} { ${cfgOnly.join(', ')} } from '@nexora/core/config';`);
          out.push(`import${typeOnly} { ${others.join(', ')} } from '@nexora/core';`);
          i += 1;
          changed = true;
          repaired += 1;
          continue;
        }
      }

      out.push(lines[i]);
    }

    if (changed) writeFileSync(file, out.join('\n'), 'utf8');
  }
}

// Report anything still importing non-config symbols from the server-only subpath.
for (const root of ['packages', 'scripts']) {
  let entries;
  try {
    entries = [...walk(path.join(ROOT, root))];
  } catch {
    continue;
  }
  for (const file of entries) {
    const text = readFileSync(file, 'utf8');
    const bad = [...text.matchAll(/import(?:\s+type)?\s*\{([^}]*)\}\s*from\s*'@nexora\/core\/config'/g)]
      .flatMap((m) => split(m[1] ?? ''))
      .filter((n) => !/^config$/.test(n));
    if (bad.length > 0) unresolved.push(`${path.relative(ROOT, file)}: ${[...new Set(bad)].join(', ')}`);
  }
}

console.log(`repaired ${repaired} import pair(s)`);
if (unresolved.length > 0) {
  console.log('still needs a manual look:');
  for (const u of unresolved) console.log(`  ${u}`);
}