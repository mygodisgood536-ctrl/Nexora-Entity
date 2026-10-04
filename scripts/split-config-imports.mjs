/**
 * Rewrite `config` imports from the shared `@nexora/core` barrel to the server-only
 * `@nexora/core/config` subpath. The barrel is consumed by client components and must stay
 * free of Node builtins; every `config` consumer here is server-side.
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

const PATTERN = /import(\s+type)?\s*\{([^}]*)\}\s*from\s*'@nexora\/core';/g;

let changedFiles = 0;
let movedImports = 0;

for (const root of ['packages', 'scripts']) {
  const base = path.join(ROOT, root);
  let entries;
  try {
    entries = [...walk(base)];
  } catch {
    continue;
  }

  for (const file of entries) {
    if (file.endsWith(path.join('core', 'src', 'config.ts'))) continue;
    const original = readFileSync(file, 'utf8');
    let count = 0;
    const updated = original.replace(PATTERN, (match, typeOnly, names) => {
      if (!/(^|[\s,])config([\s,]|$)/.test(names)) return match;
      const kept = names
        .split(',')
        .map((n) => n.trim())
        .filter((n) => n && !/^config$/.test(n));
      count += 1;
      // Mixed import lists stay one statement when other names remain.
      if (kept.length > 0) {
        return `import${typeOnly ?? ''} {${kept.join(', ')}, config} from '@nexora/core/config';\nimport${typeOnly ?? ''} {${kept.join(', ')}} from '@nexora/core';`;
      }
      return `import${typeOnly ?? ''} { config } from '@nexora/core/config';`;
    });

    if (count > 0) {
      writeFileSync(file, updated, 'utf8');
      changedFiles += 1;
      movedImports += count;
    }
  }
}

console.log(`moved ${movedImports} config import(s) across ${changedFiles} file(s)`);