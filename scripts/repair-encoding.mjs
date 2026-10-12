/**
 * Precise mojibake repair (Windows-1252 -> UTF-8 double-encoding).
 *
 * A UTF-8 file was read as Windows-1252 and written back as UTF-8, so every non-ASCII
 * character became two or three Windows-1252 characters. The exact inverse is: map each
 * character back to its Windows-1252 byte, then decode those bytes as UTF-8.
 *
 * A UTF-8 code point always decodes to two or three Windows-1252 characters, and every
 * non-ASCII byte lands in either 0xA0-0xFF or the Windows-1252 0x80-0x9F block. So a maximal
 * run of "high" characters is exactly one damaged sequence, with no ASCII interleaving.
 */
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const roots = [
  path.resolve(here, '..', 'packages'),
  path.resolve(here, '..', 'scripts'),
  path.resolve(here, '..', 'tests'),
];
const EXT = new Set(['.ts', '.tsx', '.css', '.json', '.mjs', '.ps1', '.md', '.html']);
const SKIP = /node_modules|\.pg|\.next|storage|dist/;

/** Windows-1252 bytes 0x80-0x9F map to these code points (the only difference from Latin-1). */
const CP1252_HIGH = new Map([
  [0x20ac, 0x80], [0x201a, 0x82], [0x0192, 0x83], [0x201e, 0x84], [0x2026, 0x85],
  [0x2020, 0x86], [0x2021, 0x87], [0x02c6, 0x88], [0x2030, 0x89], [0x0160, 0x8a],
  [0x2039, 0x8b], [0x0152, 0x8c], [0x017d, 0x8e], [0x2018, 0x91], [0x2019, 0x92],
  [0x201c, 0x93], [0x201d, 0x94], [0x2022, 0x95], [0x2013, 0x96], [0x2014, 0x97],
  [0x02dc, 0x98], [0x2122, 0x99], [0x0161, 0x9a], [0x203a, 0x9b], [0x0153, 0x9c],
  [0x017e, 0x9e], [0x0178, 0x9f],
]);

const HIGH_CP = new Set([
  ...CP1252_HIGH.keys(),
  ...Array.from({ length: 0x100 - 0xa0 }, (_, i) => 0xa0 + i),
  0x0080, 0x0081, 0x0083, 0x0084, 0x0085, 0x0086, 0x0087, 0x0088, 0x0089, 0x008a, 0x008b,
  0x008c, 0x008d, 0x008e, 0x008f, 0x0090, 0x0091, 0x0093, 0x0095, 0x0096, 0x0097, 0x0098,
  0x0099, 0x009a, 0x009b, 0x009c, 0x009d, 0x009e,
]);

/** Build a compact character-class regex from the code point set. */
function classFor(cps) {
  const sorted = [...cps].sort((a, b) => a - b);
  let out = '';
  let i = 0;
  while (i < sorted.length) {
    const start = sorted[i];
    let end = start;
    while (i + 1 < sorted.length && sorted[i + 1] === end + 1) {
      i += 1;
      end = sorted[i];
    }
    const esc = (c) => `\\u${c.toString(16).padStart(4, '0')}`;
    out += start === end ? esc(start) : `${esc(start)}-${esc(end)}`;
    i += 1;
  }
  return out;
}

const HIGH_CLASS = classFor(HIGH_CP);
const RUN = new RegExp(`[${HIGH_CLASS}]+`, 'g');

/** Lead characters that always indicate a still-damaged sequence. */
function stillDamaged(text) {
  for (const ch of text) {
    const cp = ch.codePointAt(0);
    if (cp === undefined) continue;
    if (cp === 0x00e2 || cp === 0x00e3 || cp === 0x00c2 || cp === 0x00c3) return true;
    if (cp >= 0x0080 && cp <= 0x009f) return true;
  }
  return false;
}

function toBytes(run) {
  const bytes = [];
  for (const ch of run) {
    const cp = ch.codePointAt(0);
    if (cp === undefined) return null;
    if (cp < 0x100) {
      bytes.push(cp);
      continue;
    }
    const mapped = CP1252_HIGH.get(cp);
    if (mapped === undefined) return null;
    bytes.push(mapped);
  }
  return Buffer.from(bytes);
}

function repairText(text) {
  let changed = 0;
  const out = text.replace(RUN, (run) => {
    if (run.length < 2) return run;
    const bytes = toBytes(run);
    if (!bytes) return run;
    const decoded = bytes.toString('utf8');
    if (decoded.includes('\uFFFD')) return run;
    if (stillDamaged(decoded)) return run;
    changed += 1;
    return decoded;
  });
  return { out, changed };
}

function walk(dir) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    if (SKIP.test(e.name)) continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      walk(full);
      continue;
    }
    if (!EXT.has(path.extname(e.name))) continue;
    const original = readFileSync(full, 'utf8');
    if (!/[^\p{ASCII}]/u.test(original)) continue;
    const { out, changed } = repairText(original);
    if (DEBUG) console.log(`  scanned ${path.relative(path.resolve(here, '..'), full)} changed=${changed}`);
    if (changed > 0) {
      writeFileSync(full, out, 'utf8');
      console.log(`repaired ${changed} run(s): ${path.relative(path.resolve(here, '..'), full)}`);
    }
  }
}

const DEBUG = process.env.NEXORA_REPAIR_DEBUG === '1';
if (DEBUG) {
  console.log(`roots: ${roots.join(', ')}`);
  console.log(`high class length: ${HIGH_CLASS.length}`);
  try {
    new RegExp(`[${HIGH_CLASS}]+`, 'g');
    console.log('regex ok');
  } catch (e) {
    console.log(`regex FAILED: ${e.message}`);
  }
  const probe = readFileSync(path.resolve(roots[0], 'engine', 'src', 'pipeline.ts'), 'utf8');
  const runs = probe.match(RUN) ?? [];
  console.log(`probe runs: ${runs.length} first=${JSON.stringify(runs[0])}`);
  if (runs[0]) console.log(`probe decoded=${JSON.stringify(toBytes(runs[0])?.toString('utf8'))}`);
}

for (const r of roots) walk(r);
console.log('encoding repair complete');