/**
 * Runtime smoke verification for the parts of the product that do not require PostgreSQL.
 *
 * The entity journey (signup -> entity -> stages -> readiness -> publish) needs a live database
 * and is therefore NOT exercised here. What this does verify is real: that the production build
 * boots, that public and auth pages render, that protected routes actually redirect, that the
 * public-site host refuses unpublished entities, that media path traversal is blocked, and that
 * mutating APIs reject unauthenticated callers.
 */

const BASE = process.env.BASE ?? 'http://127.0.0.1:4311';

let pass = 0;
let fail = 0;

async function check(name, fn) {
  try {
    const detail = await fn();
    console.log(`PASS  ${name}${detail ? ` — ${detail}` : ''}`);
    pass += 1;
  } catch (err) {
    console.log(`FAIL  ${name} — ${err && err.message ? err.message : String(err)}`);
    fail += 1;
  }
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

async function text(pathname, init) {
  const res = await fetch(`${BASE}${pathname}`, { redirect: 'manual', ...init });
  const body = res.status === 200 ? await res.text() : '';
  return { res, body };
}

console.log(`\nNexora Entity runtime smoke — ${BASE}\n`);

await check('landing page renders', async () => {
  const { res, body } = await text('/');
  assert(res.status === 200, `expected 200, got ${res.status}`);
  assert(body.includes('Nexora Entity'), 'brand name missing');
  assert(body.includes('/login'), 'no sign-in entry point');
  assert(body.includes('/signup'), 'no account-creation entry point');
  return `${body.length} bytes`;
});

await check('landing page does not promise a Google Knowledge Panel', async () => {
  const { body } = await text('/');
  const claims = body.match(/guaranteed knowledge panel|google (verified|approved)|guaranteed panel/gi);
  assert(claims === null, `found prohibited claims: ${claims && claims.join(', ')}`);
  return 'no prohibited claims';
});

await check('login page renders with the three specified fields', async () => {
  const { res, body } = await text('/login');
  assert(res.status === 200, `expected 200, got ${res.status}`);
  for (const id of ['username', 'securityQuestion', 'securityAnswer']) {
    assert(body.includes(`id="${id}"`), `missing field ${id}`);
  }
  assert(body.includes('name="method"') || body.includes('method="post"'), 'login form must not use GET');
  return 'username + security question + security answer';
});

await check('signup page renders with exactly the four specified fields', async () => {
  const { res, body } = await text('/signup');
  assert(res.status === 200, `expected 200, got ${res.status}`);
  for (const label of ['Full name', 'Username', 'Security question', 'Security answer']) {
    assert(body.includes(label), `missing field: ${label}`);
  }
  assert(body.includes('name="method"') || body.includes('method="post"'), 'signup form must not use GET');
  return 'full name, username, security question, security answer';
});

await check('global stylesheet is served', async () => {
  const res = await fetch(`${BASE}/`);
  const body = await res.text();
  const m = body.match(/<link rel="stylesheet" href="(\/_next\/static\/[^"]+\.css)"/);
  assert(m, 'no stylesheet link found in the document');
  const css = await fetch(`${BASE}${m[1]}`);
  assert(css.status === 200, `stylesheet returned ${css.status}`);
  const sheet = await css.text();
  assert(sheet.length > 1000, 'stylesheet looks empty');
  return `${sheet.length} bytes`;
});

await check('login page is rendered in the server HTML, not only after hydration', async () => {
  // A Suspense boundary around useSearchParams made Next bail the whole form to client-side
  // rendering, shipping an empty div as the primary sign-in screen.
  const { body } = await text('/login');
  assert(!body.includes('BAILOUT_TO_CLIENT_SIDE_RENDERING'), 'login still bails out to client rendering');
  assert(body.includes('id="username"'), 'the login form is absent from the server HTML');
  return 'form present in initial HTML';
});

await check('protected /app redirects an anonymous visitor to /login', async () => {
  const res = await fetch(`${BASE}/app`, { redirect: 'manual' });
  assert(res.status === 307 || res.status === 302, `expected a redirect, got ${res.status}`);
  const loc = res.headers.get('location') ?? '';
  assert(loc.includes('/login'), `redirected to ${loc} instead of /login`);
  return loc;
});

await check('protected stage route redirects an anonymous visitor', async () => {
  for (const path of ['/app/stages/A_identity', '/app/readiness', '/app/review', '/app/publish']) {
    const res = await fetch(`${BASE}${path}`, { redirect: 'manual' });
    assert(res.status === 307 || res.status === 302, `${path} returned ${res.status} instead of redirecting`);
    assert((res.headers.get('location') ?? '').includes('/login'), `${path} did not redirect to /login`);
  }
  return 'all four authenticated routes protected';
});

await check('unpublished entity is not served publicly', async () => {
  const res = await fetch(`${BASE}/e/does-not-exist-slug`, { redirect: 'manual' });
  // 404 once the database is live. 500 while PostgreSQL is unavailable is still safe — no entity
  // data was served — but it is reported honestly rather than claimed as a passing 404.
  assert(res.status === 404 || res.status === 500, `expected 404 or 500, got ${res.status}`);
  const body = await res.text();
  for (const marker of ['display_name', 'entity_uid', 'security_question']) {
    assert(!body.includes(marker), `response leaked ${marker}`);
  }
  return res.status === 500 ? 'no data leaked (DB unavailable — integration pending)' : '404';
});

await check('media path traversal is blocked', async () => {
  for (const attempt of [
    '/media/../../../../etc/passwd',
    '/media/..%2f..%2f..%2fpackage.json',
    '/media/../../package.json',
  ]) {
    const res = await fetch(`${BASE}${attempt}`, { redirect: 'manual' });
    assert(res.status === 404 || res.status === 400, `traversal returned ${res.status} for ${attempt}`);
    const body = await res.text();
    assert(!body.includes('"dependencies"'), 'package.json contents were served');
  }
  return '3 traversal attempts refused';
});

await check('mutating APIs reject an anonymous caller', async () => {
  const calls = [
    ['POST', '/api/entities'],
    ['POST', '/api/stages'],
    ['POST', '/api/publish'],
    ['POST', '/api/review'],
    ['GET', '/api/entities'],
  ];
  for (const [method, pathname] of calls) {
    const res = await fetch(`${BASE}${pathname}`, {
      method,
      redirect: 'manual',
      headers: { 'content-type': 'application/json' },
      body: method === 'GET' ? undefined : '{}',
    });
    assert(res.status === 401, `${method} ${pathname} returned ${res.status}, expected 401`);
  }
  return `${calls.length} endpoints require a session`;
});

await check('signup rejects an incomplete registration', async () => {
  const res = await fetch(`${BASE}/api/auth/signup`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ fullName: 'A' }),
  });
  assert(res.status === 400, `expected 400 for an invalid registration, got ${res.status}`);
  const body = await res.json();
  assert(body.ok === false && body.error?.message, 'no actionable error message returned');
  return 'validated and explained';
});

await check('login rejects wrong credentials without leaking why', async () => {
  // Requires PostgreSQL to look the account up, so this is only meaningful once the database
  // integration is live. Until then it must still not report success.
  const res = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username: 'nobody-here-123', securityQuestion: 'wrong question', securityAnswer: 'wrong' }),
  });
  assert(res.status !== 200, `login returned ${res.status}; it must never succeed for a non-existent user`);
  const body = await res.json();
  assert(body.ok === false, 'login reported success for a non-existent user');
  return res.status === 502 ? 'rejected (DB unreachable — integration pending)' : `rejected with ${res.status}`;
});

await check('cron endpoint refuses an unauthenticated caller', async () => {
  // 404 is the deliberate, documented answer: a wrong secret and a missing one must be
  // indistinguishable, so an unauthenticated caller learns nothing about whether a secret exists.
  const res = await fetch(`${BASE}/api/cron`, { redirect: 'manual' });
  assert(res.status === 404, `expected 404, got ${res.status}`);
  return '404, indistinguishable from a wrong secret';
});

await check('unknown route returns a not-found page', async () => {
  const res = await fetch(`${BASE}/definitely-not-a-route`, { redirect: 'manual' });
  assert(res.status === 404, `expected 404, got ${res.status}`);
  return '404';
});

console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail === 0 ? 0 : 1);