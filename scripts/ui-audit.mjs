/**
 * UI audit — the browser verification the specification demands.
 *
 * The specification (§28, §34, Amendment 2.0 §11/§13) requires that screens are
 * *looked at*, not merely asserted reachable. An HTTP 200 proves a route responded;
 * it proves nothing about hierarchy, contrast, focus order or layout.
 *
 * This harness performs, against the running platform:
 *   1. screenshots of every screen at three breakpoints
 *   2. a keyboard traversal recording tab order and whether focus is visible
 *   3. a programmatic WCAG AA contrast audit of rendered text
 *   4. a reduced-motion audit
 *   5. a 320px horizontal-overflow audit
 *
 * Usage: node scripts/ui-audit.mjs [--base http://127.0.0.1:4311]
 *        [--out artifacts/ui-audit] [--headed]
 *
 * This is a measurement instrument, not a pass/fail gate: a failing contrast
 * number must be read and fixed by a human, not silently ignored.
 */
import { mkdir, writeFile, rm, access } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { chromium } from 'playwright';

const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};

const BASE = flag('base', 'http://127.0.0.1:4311');
const OUT = path.resolve(flag('out', 'artifacts/ui-audit'));
const HEADED = args.includes('--headed');

/** Breakpoints required by the handover §4.4. */
const BREAKPOINTS = [
  { name: 'mobile', width: 320, height: 720 },
  { name: 'tablet', width: 768, height: 1024 },
  { name: 'desktop', width: 1440, height: 960 },
];

const stamp = Date.now().toString(36);
const USER = {
  fullName: 'Ada Verification',
  username: `ada.verify.${stamp}`,
  question: 'What is the name of the first product you ever shipped?',
  answer: 'Nimbus',
};

/* ── contrast maths (WCAG 2.1 relative luminance) ─────────────────────────── */

function parseColor(input) {
  const m = String(input).match(/rgba?\(([^)]+)\)/i);
  if (!m) return null;
  const parts = m[1].split(/[\s,/]+/).filter(Boolean).map(Number);
  const [r, g, b] = parts;
  const a = parts.length > 3 ? parts[3] : 1;
  if ([r, g, b].some((n) => Number.isNaN(n))) return null;
  return { r, g, b, a };
}

function luminance({ r, g, b }) {
  const channel = (v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

function contrastRatio(fg, bg) {
  const l1 = luminance(fg);
  const l2 = luminance(bg);
  const [hi, lo] = l1 > l2 ? [l1, l2] : [l2, l1];
  return (hi + 0.05) / (lo + 0.05);
}

/** Runs in the page: resolve the effective backdrop behind each text node. */
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

  /**
   * The colour a gradient actually paints behind the text.
   *
   * A surface whose background is a gradient has no meaningful `background-color`, so measuring
   * against it reports a contrast ratio of about 1 and condemns text that is plainly readable.
   *
   * Two rules keep this honest:
   *   - a gradient is only used when every one of its colour stops is fully opaque. A decorative
   *     translucent overlay (the page's radial glow) is not the backdrop; the element's own
   *     background colour underneath it is.
   *   - the gradient is painted over the element's background colour, in that order, exactly as
   *     the browser paints them.
   */
  const parseHex = (input) => {
    const m = String(input).trim().match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
    if (!m) return null;
    const hex = m[1].length === 3 ? m[1].split('').map((c) => c + c).join('') : m[1];
    return {
      r: Number.parseInt(hex.slice(0, 2), 16),
      g: Number.parseInt(hex.slice(2, 4), 16),
      b: Number.parseInt(hex.slice(4, 6), 16),
      a: 1,
    };
  };

  const gradientAverage = (image) => {
    const stops = [];
    const re = /#[0-9a-f]{3,6}\b|rgba?\([^)]*\)|\btransparent\b/gi;
    let m;
    while ((m = re.exec(image)) !== null) {
      const token = m[0];
      if (/^transparent$/i.test(token)) return null; // a translucent overlay, not a backdrop
      const c = parse(token) ?? parseHex(token);
      if (!c) return null;
      if (c.a < 1) return null;
      stops.push(c);
    }
    if (stops.length === 0) return null;
    const n = stops.length;
    return {
      r: stops.reduce((s, c) => s + c.r, 0) / n,
      g: stops.reduce((s, c) => s + c.g, 0) / n,
      b: stops.reduce((s, c) => s + c.b, 0) / n,
      a: 1,
    };
  };

  const effectiveBg = (el) => {
    let node = el;
    let acc = null;
    while (node && node.nodeType === 1) {
      const style = getComputedStyle(node);
      // The element's own background colour is the base layer.
      const base = parse(style.backgroundColor);
      let layer = base && base.a > 0 ? base : null;
      // Its background image is painted over that base.
      const image = style.backgroundImage;
      if (image && image !== 'none') {
        const avg = gradientAverage(image);
        if (avg) layer = layer ? over(avg, layer) : avg;
      }
      if (layer) {
        acc = acc === null ? layer : over(acc, layer);
        if (acc.a >= 0.999) return acc;
      }
      node = node.parentElement;
    }
    return acc && acc.a > 0 ? acc : { r: 255, g: 255, b: 255, a: 1 };
  };

  const selectorFor = (el) => {
    const id = el.id ? `#${el.id}` : '';
    const cls =
      typeof el.className === 'string' && el.className.trim()
        ? `.${el.className.trim().split(/\s+/).slice(0, 2).join('.')}`
        : '';
    return `${el.tagName.toLowerCase()}${id}${cls}`;
  };

  const out = [];

  for (const el of document.querySelectorAll('body *')) {
    // Only elements that directly render text.
    const hasOwnText = [...el.childNodes].some(
      (n) => n.nodeType === 3 && n.textContent.trim().length > 0,
    );
    if (!hasOwnText) continue;

    const cs = getComputedStyle(el);
    if (cs.visibility === 'hidden' || cs.display === 'none') continue;
    if (Number.parseFloat(cs.opacity) === 0) continue;

    const rect = el.getBoundingClientRect();
    if (rect.width < 1 || rect.height < 1) continue;

    const fg = parse(cs.color);
    if (!fg) continue;
    const bg = effectiveBg(el);
    const fgFlat = fg.a < 1 ? over(fg, bg) : fg;

    const size = Number.parseFloat(cs.fontSize);
    const weight = Number.parseInt(cs.fontWeight, 10) || 400;
    const large = size >= 24 || (size >= 18.66 && weight >= 700);

    out.push({
      selector: selectorFor(el),
      text: el.textContent.trim().slice(0, 70),
      color: `${Math.round(fgFlat.r)}, ${Math.round(fgFlat.g)}, ${Math.round(fgFlat.b)}`,
      background: `${Math.round(bg.r)}, ${Math.round(bg.g)}, ${Math.round(bg.b)}`,
      fontSize: size,
      fontWeight: weight,
      large,
      required: large ? 3 : 4.5,
    });
  }
  return out;
};

/** Focus-visibility probe: does the focused element change its outline/ring? */
const FOCUS_PROBE = () => {
  const el = document.activeElement;
  if (!el || el === document.body) return null;
  const cs = getComputedStyle(el);
  const r = el.getBoundingClientRect();
  return {
    tag: el.tagName.toLowerCase(),
    id: el.id || null,
    name: el.getAttribute('name') || null,
    text: (el.textContent || el.getAttribute('aria-label') || '').trim().slice(0, 40),
    outlineStyle: cs.outlineStyle,
    outlineWidth: cs.outlineWidth,
    outlineColor: cs.outlineColor,
    boxShadow: cs.boxShadow,
    rect: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) },
  };
};

const describe = (el) =>
  el
    ? `${el.tag.toLowerCase()}${el.id ? `#${el.id}` : ''}${
        el.name ? `[name=${el.name}]` : ''
      }${el.text ? ` "${el.text}"` : ''}`
    : '(none)';

const findings = { screens: [], contrast: [], focus: [], overflow: [], motion: null, notes: [] };

/**
 * Navigate and wait for the page to have actually rendered.
 *
 * `networkidle` is not a reliable signal against a hosted deployment: the platform keeps
 * connections alive between requests, so the network never truly goes idle and the wait times out
 * on a page that has already rendered. The document being ready and the application's own main
 * region being present is both a stronger and a faster signal.
 */
async function open(page, url) {
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45_000 });
  await page.waitForSelector('#main, body', { state: 'attached', timeout: 30_000 });
  await page.waitForTimeout(300);
}

async function auditScreen(context, label, route, { interactive = true } = {}) {
  const page = await context.newPage();
  const record = { label, path: route, shots: [], status: null, error: null };

  try {
    const response = await page.goto(`${BASE}${route}`, { waitUntil: 'domcontentloaded', timeout: 60_000 });
    record.status = response ? response.status() : null;
    await page.waitForSelector('#main, body', { state: 'attached', timeout: 30_000 });
    await page.waitForTimeout(400);

    for (const bp of BREAKPOINTS) {
      await page.setViewportSize({ width: bp.width, height: bp.height });
      await page.waitForTimeout(250);
      const file = path.join(OUT, 'screens', `${label}--${bp.name}.png`);
      await page.screenshot({ path: file, fullPage: true });
      record.shots.push(path.relative(process.cwd(), file));

      // 320px must not scroll horizontally (§28 "No horizontal overflow").
      if (bp.name === 'mobile') {
        const overflow = await page.evaluate(() => {
          const doc = document.documentElement;
          const offenders = [];
          for (const el of document.querySelectorAll('body *')) {
            const r = el.getBoundingClientRect();
            if (r.width === 0) continue;
            if (r.right > doc.clientWidth + 1) {
              offenders.push({
                tag: el.tagName.toLowerCase(),
                cls: typeof el.className === 'string' ? el.className.slice(0, 60) : '',
                right: Math.round(r.right),
              });
            }
          }
          return {
            scrollWidth: doc.scrollWidth,
            clientWidth: doc.clientWidth,
            overflowing: doc.scrollWidth > doc.clientWidth + 1,
            offenders: offenders.slice(0, 10),
          };
        });
        findings.overflow.push({ screen: label, ...overflow });
      }
    }

    await page.setViewportSize({ width: 1440, height: 960 });
    await page.waitForTimeout(200);

    const nodes = await page.evaluate(CONTRAST_PROBE);
    for (const n of nodes) {
      const fg = parseColor(`rgb(${n.color})`);
      const bg = parseColor(`rgb(${n.background})`);
      if (!fg || !bg) continue;
      const ratio = contrastRatio(fg, bg);
      if (ratio < n.required) {
        findings.contrast.push({
          screen: label,
          selector: n.selector,
          text: n.text,
          ratio: Math.round(ratio * 100) / 100,
          required: n.required,
          color: n.color,
          background: n.background,
          fontSize: n.fontSize,
        });
      }
    }

    if (interactive) {
      await page.evaluate(() => document.activeElement && document.activeElement.blur());
      const order = [];
      for (let i = 0; i < 45; i += 1) {
        await page.keyboard.press('Tab');
        const el = await page.evaluate(FOCUS_PROBE);
        if (!el) break;
        const visible =
          (el.outlineStyle !== 'none' && Number.parseFloat(el.outlineWidth) > 0) ||
          (el.boxShadow && el.boxShadow !== 'none');
        order.push({ ...el, focusVisible: visible });
      }
      findings.focus.push({ screen: label, order });
    }
  } catch (err) {
    record.error = String(err && err.message ? err.message : err);
  } finally {
    await page.close();
  }

  findings.screens.push(record);
  return record;
}

/**
 * Locate a real, already-installed Chromium browser.
 *
 * We deliberately do NOT download Playwright's bundled Chromium: this machine already has
 * Google Chrome and Microsoft Edge, and the audit must exercise a genuine browser. We try
 * Chrome first, then Edge, then fall back to Playwright's own download if one exists.
 */
const BROWSER_CANDIDATES = [
  { name: 'Google Chrome', exe: path.join(process.env['PROGRAMFILES'] ?? 'C:\\Program Files', 'Google', 'Chrome', 'Application', 'chrome.exe') },
  { name: 'Google Chrome (x86)', exe: path.join(process.env['PROGRAMFILES(X86)'] ?? 'C:\\Program Files (x86)', 'Google', 'Chrome', 'Application', 'chrome.exe') },
  { name: 'Google Chrome (local)', exe: path.join(process.env['LOCALAPPDATA'] ?? path.join(os.homedir(), 'AppData', 'Local'), 'Google', 'Chrome', 'Application', 'chrome.exe') },
  { name: 'Microsoft Edge', exe: path.join(process.env['PROGRAMFILES(X86)'] ?? 'C:\\Program Files (x86)', 'Microsoft', 'Edge', 'Application', 'msedge.exe') },
  { name: 'Microsoft Edge (x64)', exe: path.join(process.env['PROGRAMFILES'] ?? 'C:\\Program Files', 'Microsoft', 'Edge', 'Application', 'msedge.exe') },
];

async function exists(p) {
  try { await access(p); return true; } catch { return false; }
}

async function resolveBrowser() {
  for (const c of BROWSER_CANDIDATES) {
    if (await exists(c.exe)) return c;
  }
  return null;
}

async function main() {
  await rm(OUT, { recursive: true, force: true });
  await mkdir(path.join(OUT, 'screens'), { recursive: true });

  const browserChoice = await resolveBrowser();
  const launchOpts = { headless: !HEADED };
  if (browserChoice) {
    launchOpts.executablePath = browserChoice.exe;
    console.log(`Using installed browser: ${browserChoice.name}`);
    console.log(`  executable: ${browserChoice.exe}`);
  } else {
    console.log('No installed Chrome/Edge found; falling back to Playwright Chromium.');
  }

  let browser;
  try {
    browser = await chromium.launch(launchOpts);
  } catch (err) {
    // If launching the installed browser failed, try the other candidates / bundled one.
    console.error(`Launch failed for ${browserChoice?.name ?? 'default'}: ${err?.message ?? err}`);
    browser = await chromium.launch({ headless: !HEADED });
  }
  const browserVersion = browser.version();
  console.log(`Browser launched OK — version ${browserVersion}`);
  const context = await browser.newContext({
    viewport: { width: 1440, height: 960 },
    deviceScaleFactor: 1,
  });
  return { browser, context, browserChoice, browserVersion };
}

/** The audit body. Structured so the report can be written even on partial failure. */
async function audit() {
  const { browser, context, browserChoice, browserVersion } = await main();
  try {
    /* 1. sign up for real (§34: signup must work) */
    const auth = await context.newPage();
    await open(auth, `${BASE}/signup`);
    const signupResult = await auth.evaluate(async (u) => {
      const res = await fetch('/api/auth/signup', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          fullName: u.fullName,
          username: u.username,
          securityQuestion: u.question,
          securityAnswer: u.answer,
        }),
      });
      return res.json();
    }, USER);
    if (!(signupResult.ok === true)) {
      findings.notes.push(`SIGNUP_FAILED: ${JSON.stringify(signupResult).slice(0, 200)}`);
    }
    const signupUrl = auth.url();
    if (/securityAnswer|fullName|username/i.test(signupUrl)) {
      findings.notes.push(`SECURITY: credentials leaked into the URL after signup: ${signupUrl}`);
    }
    await auth.close();

    /* 2. sign in for real (§34: login must work) */
    const session = await context.newPage();
    await open(session, `${BASE}/login`);
    const loginResult = await session.evaluate(async (u) => {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          username: u.username,
          securityQuestion: u.question,
          securityAnswer: u.answer,
        }),
      });
      return res.json();
    }, USER);
    if (!(loginResult.ok === true)) {
      findings.notes.push(`LOGIN_FAILED: ${JSON.stringify(loginResult).slice(0, 200)}`);
    }
    // login sets the session cookie; navigate to /app as the signed-in user.
    await open(session, `${BASE}/app`);
    const appUrl = session.url();
    if (/securityAnswer|fullName|username/i.test(appUrl)) {
      findings.notes.push(`SECURITY: credentials leaked into the URL after login: ${appUrl}`);
    }
    await session.close();

    findings.notes.push(`Signed up and signed in as @${USER.username}.`);

    /* 3. every screen */
    await auditScreen(context, 'home', '/');
    await auditScreen(context, 'signup', '/signup', { interactive: false });
    await auditScreen(context, 'login', '/login', { interactive: false });
    await auditScreen(context, 'app-entities', '/app');

    // Create an entity so the studio screens can be reached, then record its id/slug.
    const probe = await context.newPage();
    await open(probe, `${BASE}/app`);
    let entityId = null;
    let slug = null;
    try {
    const created = await probe.evaluate(async () => {
      const res = await fetch('/api/entities', {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify({ displayName: 'Audit Person' }),
      });
      return res.json();
    });
      entityId = created?.entityId ?? null;
      slug = created?.slug ?? null;
    } catch { /* entity creation not reachable */ }
    await probe.close();

    if (slug) {
      await auditScreen(context, 'stages', `/app/stages/A_identity?entity=${entityId}`, { waitUntil: 'domcontentloaded' });
      await auditScreen(context, 'preview', `/app/preview/${slug}`);
    } else {
      findings.notes.push('Entity could not be created; stage and preview screens were not reached.');
    }
    if (entityId) {
      await auditScreen(context, 'readiness', `/app/readiness?entity=${entityId}`);
      await auditScreen(context, 'review', `/app/review?entity=${entityId}`);
      await auditScreen(context, 'publish', `/app/publish?entity=${entityId}`);
    } else {
      findings.notes.push('Entity could not be created; readiness, review and publish were not reached.');
    }

    /* 4. reduced motion (§4.4 / §4.3.9) */
    const rmContext = await browser.newContext({
      viewport: { width: 1440, height: 960 },
      reducedMotion: 'reduce',
    });
    await rmContext.addCookies(await context.cookies());
    const rmPage = await rmContext.newPage();
    await open(rmPage, `${BASE}/login`);
    findings.motion = await rmPage.evaluate(() => {
      const sample = document.querySelector('.nx-skeleton') || document.body;
      const cs = getComputedStyle(sample);
      return {
        media: 'prefers-reduced-motion: reduce',
        animationDuration: cs.animationDuration,
        transitionDuration: cs.transitionDuration,
      };
    });
    await rmContext.close();

    /* 5. report */
    const worst = [...findings.contrast].sort((a, b) => a.ratio - b.ratio).slice(0, 40);
    const noFocus = findings.focus
      .map((f) => ({
        screen: f.screen,
        items: f.order.filter((o) => !o.focusVisible).map(describe).slice(0, 12),
      }))
      .filter((f) => f.items.length);

    const lines = [];
    lines.push('# UI audit', '');
    lines.push(`Base: ${BASE}`);
    lines.push(`Browser: ${browserChoice?.name ?? 'Playwright Chromium'} — ${browserVersion}`);
    lines.push(`Executable: ${browserChoice?.exe ?? '(Playwright bundled)'}`);
    lines.push(`Screens audited: ${findings.screens.length}`, '');
    lines.push('## Screens');
    for (const s of findings.screens) {
      lines.push(`- **${s.label}** \`${s.path}\` → HTTP ${s.status}${s.error ? ` — ERROR ${s.error}` : ''}`);
    }
    lines.push('', '## Contrast failures (WCAG AA)');
    lines.push(`Total: ${findings.contrast.length}`);
    for (const c of worst) {
      lines.push(`- ${c.screen} \`${c.selector}\` ratio ${c.ratio} (needs ${c.required}) — "${c.text}"`);
    }
    lines.push('', '## Focus without a visible indicator');
    lines.push(`Screens affected: ${noFocus.length}`);
    for (const f of noFocus) lines.push(`- ${f.screen}: ${f.items.join(', ')}`);
    lines.push('', '## Horizontal overflow at 320px');
    for (const o of findings.overflow) {
      lines.push(`- ${o.screen}: scrollWidth ${o.scrollWidth} vs clientWidth ${o.clientWidth} → ${o.overflowing ? 'OVERFLOW' : 'ok'}`);
      for (const off of o.offenders) lines.push(`  - \`${off.tag}.${off.cls}\` right=${off.right}`);
    }
    lines.push('', '## Reduced motion', JSON.stringify(findings.motion), '');
    lines.push('## Notes');
    for (const n of findings.notes) lines.push(`- ${n}`);

    await writeFile(path.join(OUT, 'report.md'), lines.join('\n'), 'utf8');
    await writeFile(path.join(OUT, 'report.json'), JSON.stringify(findings, null, 2), 'utf8');

    console.log(lines.join('\n'));
    console.log(`\nScreenshots: ${path.relative(process.cwd(), path.join(OUT, 'screens'))}`);
  } finally {
    try { await browser.close(); } catch { /* already gone */ }
  }
}

/**
 * Entry point.
 *
 * A single step failing must not discard measurements already taken: on a
 * memory-constrained agent the browser can be terminated mid-flow, and the contrast,
 * focus and overflow figures already gathered remain valid evidence.
 */
audit().catch((err) => {
  console.error('ui-audit failed:', err?.message ?? err);
  console.error('Partial results, if any, are in', OUT);
  process.exitCode = 1;
});