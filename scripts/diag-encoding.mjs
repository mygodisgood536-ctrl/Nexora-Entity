import { readFileSync } from 'node:fs';

for (const f of [
  'C:/Users/adede/nexora-entity/packages/db/src/repos-sources.ts',
  'C:/Users/adede/nexora-entity/packages/engine/src/pipeline.ts',
]) {
  const s = readFileSync(f, 'utf8');
  const m = /[\u0080-\u009F\u00C2-\u00C3\u00E2]/g;
  let match;
  let count = 0;
  console.log(`\n=== ${f} ===`);
  while ((match = m.exec(s)) !== null && count < 12) {
    const start = Math.max(0, match.index - 35);
    const seg = s.slice(start, match.index + 35);
    const codes = [...seg]
      .filter((ch) => {
        const c = ch.codePointAt(0) ?? 0;
        return (c >= 0x80 && c <= 0x9f) || (c >= 0xc2 && c <= 0xc3) || c === 0xe2;
      })
      .map((ch) => 'U+' + ch.codePointAt(0).toString(16).toUpperCase().padStart(4, '0'));
    console.log(`  at ${match.index}: ${JSON.stringify(seg)}  codes: ${codes.join(' ')}`);
    count += 1;
  }
}