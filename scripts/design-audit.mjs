/**
 * Design audit for the pages reachable without a database.
 *
 * Measures what a person actually sees at four viewports on the public and auth entry points:
 * horizontal overflow, text contrast against the effective backdrop, keyboard focus visibility,
 * tap-target sizing on narrow screens, and console errors. Screenshots are written for visual
 * inspection.
 *
 * The authenticated screens (entity builder, readiness, review, publish) are NOT covered here
 * because they require PostgreSQL. Running `npm run ui:audit` after the database integration
 * covers those.
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';

const BASE = process.env.BASE ?? 'http://127.0.0.1:4311';
const OUT = path.resolve(process.env.OUT ?? 'artifacts/design-audit');

const VIEWPORTS = [
  { name: 'desktop', width: 1440, height: 900, touch: false },
  { name: 'laptop', width: 1280, height: 800, touch: false },
  { name: 'tablet', width: 768, height: 1024, touch: true },
  { name: 'mobile', width: 390, height: 844, touch: true },
  { name: 'narrow', width: 320, height: 700, touch: true },
];

const PAGES = [
  { name: 'landing', path: '/' },
  { name: 'login', path: '/login' },
  { name: 'signup', path: '/signup' },
];

mkdirSync(OUT, { recursive: true });

// ── contrast maths ────────────────────────────────────────────────────────────────────────
const CONTRAST_PROBE = () => {
  const parse = (input) => {
    const m = String(input).match(/rgba?\(([^)]+)\)/i);
    if (!m) return null;
    const p = m[1].split(/[\s,/]+/).filter(Boolean).map(Number);
    if (p.length < 3 || p.slice(0, 3).some(Number.isNaN)) return null;
    return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 };
  };
  const over = (top, bottom) => ({
    r: top.r * top.a + bottom.r * (1 - top.a),
    g: top.g * top.a + bottom.g * (1 - top.a),
    b: top.b * top.a + bottom.b * (1 - top.a),
    a: 1,
  });
  const effectiveBg = (el) => {
    let node = el;
    let acc = null;
    while (node && node !== document.documentElement) {
      const c = parse(getComputedStyle(node).backgroundColor);
      if (c && c.a > 0) {
        acc = acc ? over(acc, c) : c;
        if (acc.a >= 1) return acc;
      }
      node = node.parentElement;
    }
    return acc ?? { r: 255, g: 255, b: 255, a: 1 };
  };
  // Colours are collected here and the ratio is computed in Node below, so no luminance
  // calculation is needed inside the page context.

  const out = [];
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  const seen = new Set();
  let node;
  while ((node = walker.nextNode())) {
    const text = node.textContent.trim();
    if (text.length < 3) continue;
    const el = node.parentElement;
    if (!el || seen.has(el)) continue;
    seen.add(el);
    const cs = getComputedStyle(el);
    if (cs.visibility === 'hidden' || cs.display === 'none' || Number(cs.opacity) === 0) continue;
    const rect = el.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) continue;

    const fg = parse(cs.color);
    if (!fg) continue;
    const bg = effectiveBg(el);
    // A translucent text colour (or one sitting on a translucent ancestor) must be flattened
    // onto its effective backdrop before the ratio is computed, otherwise the audit measures an
    // alpha channel instead of the colour a person actually sees.
    const fgFlat = fg.a < 1 ? over(fg, bg) : fg;
    const size = Number.parseFloat(cs.fontSize);
    const weight = Number.parseInt(cs.fontWeight, 10) || 400;
    const large = size >= 24 || (size >= 18.66 && weight >= 700);
    out.push({
      tag: el.tagName.toLowerCase(),
      cls: typeof el.className === 'string' ? el.className.slice(0, 70) : '',
      text: text.slice(0, 48),
      fg: fgFlat,
      bg,
      fontSize: size,
      weight,
      required: large ? 3 : 4.5,
      x: Math.round(rect.x),
      y: Math.round(rect.y),
      w: Math.round(rect.width),
      h: Math.round(rect.height),
    });
  }
  return out;
};

const OVERFLOW_PROBE = () => {
  const doc = document.documentElement;
  const offenders = [];
  for (const el of document.querySelectorAll('body *')) {
    const r = el.getBoundingClientRect();
    if (r.width === 0) continue;
    if (r.right > doc.clientWidth + 1 || r.left < -1) {
      offenders.push({
        tag: el.tagName.toLowerCase(),
        cls: typeof el.className === 'string' ? el.className.slice(0, 60) : '',
        left: Math.round(r.left),
        right: Math.round(r.right),
      });
    }
  }
  return { scrollWidth: doc.scrollWidth, clientWidth: doc.clientWidth, offenders: offenders.slice(0, 8) };
};

const TAP_PROBE = () => {
  const small = [];
  for (const el of document.querySelectorAll('a[href], button, input, select, textarea')) {
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) continue;
    const cs = getComputedStyle(el);
    // `sr-only` elements (the skip link) are 1x1 and clipped until focused. That is correct
    // accessibility behaviour, not a small tap target, so they are excluded.
    const visuallyHidden = r.width <= 2 && r.height <= 2;
    if (visuallyHidden) continue;
    if (r.height < 32 || r.width < 32) {
      small.push({
        tag: el.tagName.toLowerCase(),
        cls: typeof el.className === 'string' ? el.className.slice(0, 50) : '',
        text: (el.textContent || el.getAttribute('aria-label') || '').trim().slice(0, 40),
        w: Math.round(r.width),
        h: Math.round(r.height),
        display: cs.display,
      });
    }
  }
  return small;
};

const FOCUS_PROBE = () => {
  const el = document.activeElement;
  if (!el || el === document.body) return null;
  const cs = getComputedStyle(el);
  return {
    tag: el.tagName.toLowerCase(),
    text: (el.textContent || el.getAttribute('aria-label') || '').trim().slice(0, 40),
    outlineStyle: cs.outlineStyle,
    outlineWidth: cs.outlineWidth,
    boxShadow: cs.boxShadow,
    visible:
      (cs.outlineStyle !== 'none' && Number.parseFloat(cs.outlineWidth) > 0) ||
      (cs.boxShadow && cs.boxShadow !== 'none'),
  };
};

function luminance({ r, g, b }) {
  const ch = (v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * ch(r) + 0.7152 * ch(g) + 0.0722 * ch(b);
}
function contrastRatio(fg, bg) {
  const l1 = luminance(fg);
  const l2 = luminance(bg);
  const [hi, lo] = l1 > l2 ? [l1, l2] : [l2, l1];
  return (hi + 0.05) / (lo + 0.05);
}

const report = { pages: [], summary: {} };
const browser = await chromium.launch({ channel: 'chrome', headless: true });

for (const vp of VIEWPORTS) {
  for (const p of PAGES) {
    // A context is created per page rather than per viewport. Chromium's touch/device-metrics
    // emulation does not reliably apply to every page in a shared context, which silently left
    // `(pointer: coarse)` false on some pages and produced false-positive tap-target findings.
    const context = await browser.newContext({
      viewport: { width: vp.width, height: vp.height },
      hasTouch: vp.touch,
      isMobile: vp.touch,
    });
    const page = await context.newPage();
    const consoleErrors = [];
    page.on('console', (m) => {
      if (m.type() === 'error') consoleErrors.push(m.text().slice(0, 160));
    });
    page.on('pageerror', (e) => consoleErrors.push(`pageerror: ${String(e).slice(0, 160)}`));

    const entry = {
      page: p.name,
      viewport: vp.name,
      width: vp.width,
      expectsTouch: vp.touch,
      consoleErrors,
      contrast: [],
      overflow: null,
      tapTargets: [],
      focus: [],
    };

    try {
      const res = await page.goto(`${BASE}${p.path}`, { waitUntil: 'networkidle', timeout: 30_000 });
      entry.status = res ? res.status() : null;
      await page.waitForTimeout(250);

      await page.screenshot({ path: path.join(OUT, `${p.name}--${vp.name}.png`), fullPage: true });

      // Record the pointer mode actually in effect, and whether emulation did what was asked.
      entry.coarsePointer = await page.evaluate(() => matchMedia('(pointer: coarse)').matches);
      entry.maxTouchPoints = await page.evaluate(() => navigator.maxTouchPoints);
      entry.emulationOK = vp.touch ? entry.coarsePointer === true : entry.coarsePointer === false;

      const overflow = await page.evaluate(OVERFLOW_PROBE);
      entry.overflow = overflow;
      if (overflow.offenders.length > 0) entry.overflowFindings = overflow.offenders;

      if (vp.name === 'mobile' || vp.name === 'narrow') {
        entry.tapTargets = await page.evaluate(TAP_PROBE);
      }

      for (const n of await page.evaluate(CONTRAST_PROBE)) {
        const ratio = contrastRatio(n.fg, n.bg);
        if (ratio < n.required) {
          entry.contrast.push({
            selector: `${n.tag}.${n.cls}`.slice(0, 90),
            text: n.text,
            ratio: Math.round(ratio * 100) / 100,
            required: n.required,
            fontSize: Math.round(n.fontSize * 10) / 10,
            weight: n.weight,
          });
        }
      }

      for (let i = 0; i < 22; i += 1) {
        await page.keyboard.press('Tab');
        const el = await page.evaluate(FOCUS_PROBE);
        if (!el) break;
        entry.focus.push(el);
      }
      const invisible = entry.focus.filter((f) => !f.visible);
      entry.focusWithoutIndicator = invisible.length;
    } catch (err) {
      entry.error = String(err).slice(0, 200);
    }

    report.pages.push(entry);
    await page.close();
    await context.close();
  }
}
await browser.close();

let overflowIssues = 0;
let contrastIssues = 0;
let tapIssues = 0;
let focusIssues = 0;
let consoleTotal = 0;
let emulationFailures = 0;
for (const e of report.pages) {
  if (e.overflowFindings) overflowIssues += e.overflowFindings.length;
  contrastIssues += e.contrast.length;
  focusIssues += e.focusWithoutIndicator ?? 0;
  consoleTotal += e.consoleErrors.length;
  if (e.emulationOK === false) {
    // Touch emulation did not take effect, so this run says nothing about touch targets.
    emulationFailures += 1;
  } else {
    tapIssues += e.tapTargets.length;
  }
}
report.summary = {
  combinations: report.pages.length,
  overflowIssues,
  contrastIssues,
  tapTargetIssues: tapIssues,
  touchEmulationUnreliable: emulationFailures,
  focusWithoutIndicator: focusIssues,
  consoleErrors: consoleTotal,
};

writeFileSync(path.join(OUT, 'report.json'), JSON.stringify(report, null, 2));

console.log('\nNexora Entity design audit — pages reachable without a database\n');
console.log(`combinations audited        : ${report.summary.combinations}`);
console.log(`horizontal overflow findings: ${overflowIssues}`);
console.log(`contrast findings           : ${contrastIssues}`);
console.log(`tap targets under 32px      : ${tapIssues}`);
console.log(`focus stops with no ring    : ${focusIssues}`);
console.log(`console errors              : ${consoleTotal}`);
console.log(
  `touch emulation unreliable   : ${emulationFailures} row(s) excluded from tap-target results`,
);

for (const e of report.pages) {
  if (e.error) {
    // A page that never loaded produces zero findings, which reads exactly like a clean page.
    // Navigation failures must be counted as failures, never as "nothing to report".
    console.log(`ERROR   ${e.page.padEnd(9)} ${String(e.width).padStart(5)}px  — ${e.error.split('\n')[0]}`);
    continue;
  }
  const issues = (e.overflowFindings?.length ?? 0) + e.contrast.length + e.tapTargets.length + (e.focusWithoutIndicator ?? 0) + e.consoleErrors.length;
  console.log(`${issues === 0 ? 'CLEAN' : 'ISSUES'}  ${e.page.padEnd(9)} ${String(e.width).padStart(5)}px  (HTTP ${e.status}, coarse=${e.coarsePointer}, touch=${e.maxTouchPoints ?? 0})${issues === 0 ? '' : ` — ${issues}`}`);
  if (e.emulationOK === false) {
    console.log('         NOTE: touch emulation did not apply; tap-target findings for this row are not trustworthy');
    continue;
  }
  for (const o of e.overflowFindings ?? []) console.log(`         overflow: <${o.tag} class="${o.cls}"> right=${o.right}`);
  for (const c of e.contrast) console.log(`         contrast: ${c.ratio} < ${c.required} — "${c.text}" (${c.selector})`);
  for (const t of e.tapTargets) console.log(`         tap target: ${t.w}x${t.h} — "${t.text}"`);
  for (const err of e.consoleErrors) console.log(`         console: ${err}`);
}
console.log(`\nscreenshots: ${path.relative(process.cwd(), OUT)}`);
console.log(`report:      ${path.relative(process.cwd(), path.join(OUT, 'report.json'))}\n`);

const loadFailures = report.pages.filter((e) => e.error).length;
if (loadFailures > 0) {
  console.error(`${loadFailures} of ${report.pages.length} page loads FAILED. The audit did not actually measure anything.`);
  process.exit(1);
}
if (overflowIssues > 0 || contrastIssues > 0 || focusIssues > 0) {
  process.exit(1);
}