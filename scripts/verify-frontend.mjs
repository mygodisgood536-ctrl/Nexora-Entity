/**
 * Full frontend verification.
 *
 * The vision asks for a premium, responsive, accessible interface whose text is clearly visible
 * and whose screens work on a phone, a tablet and a desktop. Asserting those properties is the
 * only way to know they still hold after a change, so this measures them in a real browser:
 *
 *   - no horizontal overflow at any viewport,
 *   - every visible piece of text meeting WCAG AA against the surface it sits on,
 *   - no uncaught error in the browser console.
 *
 * Both themes are checked, because a design that is legible in one is not automatically legible in
 * the other. The browser is the one already installed on the machine; nothing is downloaded.
 *
 * Usage: node scripts/verify-frontend.mjs [--base http://127.0.0.1:4311]
 */
import { chromium } from 'playwright';

const args = process.argv.slice(2);
const baseArg = args.indexOf('--base');
const BASE = baseArg >= 0 && args[baseArg + 1] ? args[baseArg + 1] : 'http://127.0.0.1:4311';

const VIEWPORTS = [
  { name: 'mobile', width: 320, height: 720 },
  { name: 'phone', width: 390, height: 844 },
  { name: 'tablet', width: 768, height: 1024 },
  { name: 'laptop', width: 1280, height: 800 },
  { name: 'desktop', width: 1440, height: 900 },
];

const BROWSER_PATHS = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
];

async function findBrowser() {
  const { existsSync } = await import('node:fs');
  for (const p of BROWSER_PATHS) if (existsSync(p)) return p;
  return undefined;
}

let failures = 0;
function check(name, ok, detail = '') {
  if (!ok) failures += 1;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`);
}

async function signIn(page) {
  const stamp = Date.now().toString(36);
  await open(page, `${BASE}/signup`);
  await page.evaluate(async (u) => {
    const post = async (path, body) => {
      const res = await fetch(path, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      const text = await res.text();
      return { status: res.status, body: text.slice(0, 200) };
    };
    const results = [];
    results.push(await post('/api/auth/signup', u));
    results.push(await post('/api/auth/login', {
      username: u.username,
      securityQuestion: u.securityQuestion,
      securityAnswer: u.securityAnswer,
    }));
    results.push(await post('/api/entities', { displayName: 'Verification Person' }));
    (globalThis.__signIn = results);
  }, { fullName: 'Verification Person', username: `ui.verify.${stamp}`, securityQuestion: 'What is the name of the first product you ever shipped?', securityAnswer: 'Nimbus' });

  const results = await page.evaluate(() => globalThis.__signIn);
  const failed = (results ?? []).filter((r) => r.status !== 200);
  if (failed.length) {
    console.log(`  sign-in problems: ${JSON.stringify(failed)}`);
  }
}

/**
 * Open a screen, retrying a transient network failure.
 *
 * A development server compiles a route the first time it is requested, and this audit visits a
 * large number of routes in quick succession. The occasional dropped connection is the server
 * catching up, not a defect in the page, so it is retried rather than reported.
 */
async function open(page, url) {
  let lastError;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45_000 });
      return;
    } catch (err) {
      lastError = err;
      await page.waitForTimeout(500);
    }
  }
  throw lastError;
}

async function auditScreen(page, url, label) {
  await open(page, url);
  await page.waitForTimeout(500);
  const r = await page.evaluate(() => {
    const doc = document.documentElement;
    const overflowing = [];
    for (const el of document.querySelectorAll('body *')) {
      const b = el.getBoundingClientRect();
      if (b.width === 0) continue;
      if (b.right > doc.clientWidth + 1) {
        overflowing.push(`${el.tagName.toLowerCase()}.${String(el.className).split(' ').slice(0, 2).join('.')}`);
      }
    }
    // Text that sits on a solid surface must clear WCAG AA.
    const parse = (input) => {
      const m = String(input).match(/rgba?\(([^)]+)\)/);
      if (!m) return null;
      const p = m[1].split(/[\s,/]+/).filter(Boolean).map(Number);
      if (p.length < 3) return null;
      return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 };
    };
    const lum = ({ r, g, b }) => {
      const ch = (v) => { const s = v / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; };
      return 0.2126 * ch(r) + 0.7152 * ch(g) + 0.0722 * ch(b);
    };
    const ratio = (f, b) => { const a = lum(f), c = lum(b); const [hi, lo] = a > c ? [a, c] : [c, a]; return (hi + 0.05) / (lo + 0.05); };
    const over = (t, b) => ({ r: t.r * t.a + b.r * (1 - t.a), g: t.g * t.a + b.g * (1 - t.a), b: t.b * t.a + b.b * (1 - t.a), a: 1 });
    const backdrop = (el) => {
      let acc = null;
      let node = el;
      while (node && node.nodeType === 1) {
        const cs = getComputedStyle(node);
        const bc = parse(cs.backgroundColor);
        if (bc && bc.a > 0) { acc = acc ? over(acc, bc) : bc; if (acc.a >= 0.999) return acc; }
        node = node.parentElement;
      }
      return acc && acc.a > 0 ? acc : { r: 255, g: 255, b: 255, a: 1 };
    };
    const lowContrast = [];
    for (const el of document.querySelectorAll('h1,h2,h3,p,a,span,li,button,label,td,th')) {
      const own = [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim().length > 0);
      if (!own) continue;
      const cs = getComputedStyle(el);
      if (cs.visibility === 'hidden' || cs.display === 'none') continue;
      if (cs.backgroundImage !== 'none') continue;
      if (el.closest('.nx-sr-only,[aria-hidden="true"]')) continue;
      const box = el.getBoundingClientRect();
      if (box.width < 1 || box.height < 1) continue;
      const fg = parse(cs.color);
      if (!fg) continue;
      const bg = backdrop(el);
      const size = parseFloat(cs.fontSize);
      const weight = parseInt(cs.fontWeight, 10) || 400;
      const need = size >= 24 || (size >= 18.66 && weight >= 700) ? 3 : 4.5;
      const got = ratio(fg, bg);
      if (got < need) lowContrast.push(`${got.toFixed(2)}<${need} "${el.textContent.trim().slice(0, 34)}"`);
    }
    return {
      scrollWidth: doc.scrollWidth,
      clientWidth: doc.clientWidth,
      overflowing: overflowing.slice(0, 5),
      lowContrast: lowContrast.slice(0, 5),
      lowContrastCount: lowContrast.length,
      title: document.title,
      h1: (document.querySelector('h1')?.textContent || '').trim().slice(0, 60),
    };
  });
  return r;
}

(async () => {
  const executablePath = await findBrowser();
  const b = await chromium.launch({ executablePath, headless: true });
  const ctx = await b.newContext();
  const page = await ctx.newPage();
  const errors = [];
  // The development server's hot-reload socket is not a product signal; it is filtered out.
  const isNoise = (t) => /_next\/hmr|WebSocket connection to/i.test(t);
  page.on('pageerror', (e) => { if (!isNoise(String(e))) errors.push(String(e).slice(0, 140)); });
  page.on('console', (m) => { if (m.type() === 'error' && !isNoise(m.text())) errors.push(m.text().slice(0, 140)); });

  await signIn(page);
  const entityId = await page.evaluate(async () => {
    const r = await fetch('/api/entities');
    const b = await r.json();
    return b.entities?.[0]?.id ?? null;
  });
  check('a signed-in account has an entity', Boolean(entityId), String(entityId));

  const screens = [
    ['home', '/'],
    ['login', '/login'],
    ['signup', '/signup'],
    ['entities', '/app'],
    ['stage', `/app/stages/A_identity?entity=${entityId}`],
    ['readiness', `/app/readiness?entity=${entityId}`],
    ['review', `/app/review?entity=${entityId}`],
    ['publish', `/app/publish?entity=${entityId}`],
    ['settings', '/app/settings'],
  ];

  for (const theme of ['light', 'dark']) {
    await page.addInitScript((t) => { try { localStorage.setItem('nexora-theme', t); } catch (e) {} }, theme);
    for (const vp of VIEWPORTS) {
      await page.setViewportSize({ width: vp.width, height: vp.height });
      for (const [label, url] of screens) {
        const r = await auditScreen(page, `${BASE}${url}`, label);
        const tag = `${theme}/${vp.name}/${label}`;
        check(`${tag}: no horizontal overflow`, r.scrollWidth <= r.clientWidth + 1, `scrollWidth ${r.scrollWidth} vs ${r.clientWidth} ${r.overflowing.join(', ')}`);
        check(`${tag}: text is legible`, r.lowContrastCount === 0, r.lowContrast.join(' | '));
      }
    }
  }

  console.log(`\nconsole/page errors: ${errors.length}`);
  for (const e of errors.slice(0, 5)) console.log(`  ${e}`);
  check('no uncaught errors in the browser', errors.length === 0, `${errors.length}`);

  await b.close();
  console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECKS FAILED`}\n`);
  process.exit(failures === 0 ? 0 : 1);
})().catch((e) => { console.error('FATAL', e.message); process.exit(1); });
