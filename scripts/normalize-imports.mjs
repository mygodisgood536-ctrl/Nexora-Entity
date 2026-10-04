/**
 * Rewrite relative imports from Node-ESM style ('./x.js') to bundler style ('./x').
 * TypeScript's `moduleResolution: bundler` and every bundler used here resolve extensionless
 * specifiers, so the extensions were purely an artefact of authoring for Node ESM directly.
 */
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(process.cwd());
const SKIP = /node_modules|\.next|\.pg|storage|dist|coverage/;
const EXTS = ['.ts', '.tsx', '.mjs', '.js'];

function* walk(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (SKIP.test(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      yield* walk(full);
    } else if (EXTS.includes(path.extname(entry.name))) {
      yield full;
    }
  }
}

// Only relative specifiers that point at a sibling source file and already end in .js/.jsx.
const RELATIVE = /(from\s+|import\s*\(\s*|export\s+\*\s+from\s+|require\s*\(\s*)(['"])(\.\.?\/[^'"]+)\.(js|jsx)\2/g;

let changedFiles = 0;
let changedImports = 0;

for (const root of ['packages', 'scripts']) {
  const base = path.join(ROOT, root);
  if (!statSync(base, { throwIfNoEntry: false })) continue;
  for (const file of walk(base)) {
    const original = readFileSync(file, 'utf8');
    let count = 0;
    const updated = original.replace(RELATIVE, (_m, prefix, quote, spec) => {
      count += 1;
      return `${prefix}${quote}${spec}${quote}`;
    });
    if (count > 0) {
      writeFileSync(file, updated, 'utf8');
      changedFiles += 1;
      changedImports += count;
    }
  }
}

console.log(`rewrote ${changedImports} relative import(s) across ${changedFiles} file(s)`);