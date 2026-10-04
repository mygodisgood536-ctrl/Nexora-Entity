/**
 * Real HTTP smoke test of the running platform.
 *
 * Signs up a fresh account, creates an entity, exercises the AI provider endpoints against the
 * live OpenCode server, and reads the public landing page. Nothing is stubbed: every assertion is
 * made against a live HTTP response from the built application.
 */

const BASE = process.env.NEXORA_BASE_URL ?? 'http://127.0.0.1:4311';

let passed = 0;
let failed = 0;
const failures: string[] = [];

function check(name: string, ok: boolean, detail = ''): void {
  if (ok) {
    passed += 1;
    console.log(`  PASS  ${name}`);
  } else {
    failed += 1;
    failures.push(`${name}${detail ? ` — ${detail}` : ''}`);
    console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

/** A cookie jar, so the session cookie survives across requests like a browser would keep it. */
const jar = new Map<string, string>();
let cookieHeader = '';

function rememberCookies(res: Response): void {
  const setCookies = res.headers.getSetCookie?.() ?? [];
  for (const raw of setCookies) {
    const [pair] = raw.split(';');
    const eq = (pair ?? '').indexOf('=');
    if (eq > 0) jar.set((pair ?? '').slice(0, eq).trim(), (pair ?? '').slice(eq + 1).trim());
  }
  cookieHeader = [...jar.entries()].map(([k, v]) => `${k}=${v}`).join('; ');
}

async function api(pathname: string, init: RequestInit = {}): Promise<{ res: Response; body: any }> {
  const headers = new Headers(init.headers);
  if (cookieHeader) headers.set('cookie', cookieHeader);
  if (init.body && !headers.has('content-type')) headers.set('content-type', 'application/json');
  const res = await fetch(`${BASE}${pathname}`, { ...init, headers, redirect: 'manual' });
  rememberCookies(res);
  const text = await res.text();
  let body: unknown = text;
  try {
    body = JSON.parse(text);
  } catch {
    /* keep the text */
  }
  return { res, body };
}

const stamp = Date.now().toString(36);
const USERNAME = `smoke_${stamp}`;
const QUESTION = 'What is the name of your first project?';
const ANSWER = 'orbit';

/** A navigation request, as a browser makes it. */
function browserHeaders(): Record<string, string> {
  return { accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8' };
}

async function main(): Promise<void> {
  console.log(`\n========== PLATFORM HTTP SMOKE TEST (${BASE}) ==========\n`);

  console.log('--- 1. public landing page ---');
  const landing = await api('/');
  check('landing responds 200', landing.res.status === 200, `got ${landing.res.status}`);
  check('landing is HTML', typeof landing.body === 'string' && landing.body.includes('<!DOCTYPE html>'));
  check('landing states the product name', String(landing.body).includes('Nexora Entity'));

  console.log('\n--- 2. account creation ---');
  const signup = await api('/api/auth/signup', {
    method: 'POST',
    body: JSON.stringify({
      fullName: `Smoke Tester ${stamp}`,
      username: USERNAME,
      securityQuestion: QUESTION,
      securityAnswer: ANSWER,
    }),
  });
  check(
    'signup accepted',
    signup.res.status === 200 && signup.body?.ok === true,
    `status ${signup.res.status} ${JSON.stringify(signup.body).slice(0, 200)}`,
  );

  console.log('\n--- 3. authentication is enforced ---');
  const anonJar = cookieHeader;
  cookieHeader = '';
  const anonApp = await api('/app');
  check('unauthenticated /app redirects to login', anonApp.res.status === 307 || anonApp.res.status === 302, `got ${anonApp.res.status}`);
  cookieHeader = anonJar;

  console.log('\n--- 4. sign in ---');
  const badLogin = await api('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ username: USERNAME, securityQuestion: QUESTION, securityAnswer: 'wrong answer' }),
  });
  check('wrong security answer is rejected', badLogin.res.ok === false, JSON.stringify(badLogin.body).slice(0, 160));

  const login = await api('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ username: USERNAME, securityQuestion: QUESTION, securityAnswer: ANSWER }),
  });
  check('correct credentials sign in', login.res.status === 200 && login.body?.ok === true, JSON.stringify(login.body).slice(0, 160));

  console.log('\n--- 5. authenticated studio ---');
  const app = await api('/app');
  check('/app renders for a signed-in user', app.res.status === 200, `got ${app.res.status}`);
  check('studio does not leak a login redirect', !String(app.body).includes('name="securityAnswer"'));

console.log('\n--- 6. entity creation ---');
  const create = await api('/api/entities', {
    method: 'POST',
    body: JSON.stringify({ displayName: `Smoke Test Person ${stamp}` }),
  });
  // A fetch caller receives JSON...
  check('fetch callers receive JSON', create.res.status === 200 && create.body?.ok === true, `got ${create.res.status}`);

  // ...while a browser form post is redirected onward, so the person is never left staring at
  // a JSON blob after creating their entity.
  const created = await api('/api/entities', {
    method: 'POST',
    headers: browserHeaders(),
    body: new URLSearchParams({ displayName: `Smoke Form Person ${stamp}` }).toString(),
  });
  check(
    'a browser form post is redirected to the first stage',
    created.res.status === 303,
    `got ${created.res.status}`,
  );
  check('the redirect points at stage A', String(created.res.headers.get('location') ?? '').includes('/app/stages/A_identity'), String(created.res.headers.get('location')));
  check('entity created', create.res.status === 200 && create.body?.ok === true, JSON.stringify(create.body).slice(0, 200));
  // The create endpoint answers { ok: true, entityId, slug, next }.
  const entityId: string | undefined = create.body?.entityId;
  const slug: string | undefined = create.body?.slug;
  check('entity has an id', Boolean(entityId), JSON.stringify(create.body).slice(0, 200));
  check('entity creation points at the next stage', String(create.body?.next ?? '').includes('/app/stages/'), String(create.body?.next));

  console.log('\n--- 7. AI provider discovery (live OpenCode) ---');
  const providers = await api('/api/ai/providers');
  check('providers endpoint responds', providers.res.status === 200, `got ${providers.res.status}`);
  // Shape is { ok, data: { providers: [{ id, connected, models: [...] }] } }.
  const catalogue = providers.body?.data ?? {};
  const providerList: any[] = catalogue.providers ?? [];
  check('provider discovery returns real data', providerList.length > 0, JSON.stringify(catalogue).slice(0, 200));
  check('the live OpenCode version is reported', typeof catalogue.opencodeVersion === 'string', String(catalogue.opencodeVersion));

  const connected: any[] = providerList.filter((p) => p.connected);
  check('a connected provider is reported', connected.length > 0, `providers: ${providerList.map((p) => p.id).join(', ')}`);

console.log('\n--- 8. model verification round-trip (live model call) ---');
  const connectedProvider = connected[0];
  const allModels: any[] = providerList.flatMap((p) => p.models ?? []);
  const usableModels = allModels.filter((m) => m.usable !== false);
  check('a model is advertised', allModels.length > 0, `${allModels.length} model(s) discovered`);

  // A free model can fail transiently on its first call, so the test tries each advertised model
  // until one answers. Which model answers is reported, rather than assumed.
  let verified: any = null;
  let verifiedWith = '';
  const attempts: string[] = [];
  if (connectedProvider?.id) {
    for (const model of (usableModels.length > 0 ? usableModels : allModels).slice(0, 4)) {
      const res = await api('/api/ai/verify', {
        method: 'POST',
        body: JSON.stringify({ providerId: connectedProvider.id, modelId: model.id }),
      });
      if (res.body?.ok === true) {
        verified = res.body.data;
        verifiedWith = model.id;
        break;
      }
      attempts.push(`${model.id}: ${res.body?.error?.code ?? `HTTP ${res.res.status}`}`);
    }
  }

  check(
    'a real model round trip succeeded',
    Boolean(verified),
    attempts.length > 0 ? attempts.join('; ') : 'no model to try',
  );

  if (verified) {
    // These values only exist if a live call actually happened: a non-zero latency and a
    // verification timestamp cannot be produced without one.
    check('the verified provider and model are named', Boolean(verified.providerName && verified.modelName), JSON.stringify(verified).slice(0, 200));
    check('the round trip recorded real latency', typeof verified.latencyMs === 'number' && verified.latencyMs > 0, `latencyMs=${verified.latencyMs}`);
    check('verification is timestamped', typeof verified.verifiedAt === 'string' && !Number.isNaN(Date.parse(verified.verifiedAt)), String(verified.verifiedAt));
    console.log(`         (verified with ${verifiedWith})`);
  }

  console.log('\n--- 9. guided stages ---');
  if (entityId) {
    const stages = await api(`/api/stages?entityId=${entityId}`);
    check('stages endpoint serves the entity', stages.res.status === 200, `got ${stages.res.status}`);
    const stageList = stages.body?.data?.stages ?? stages.body?.stages ?? [];
    check('guided stages are returned', stageList.length > 0, JSON.stringify(stages.body).slice(0, 200));
    // Rows use snake_case column names, as they come straight from the repository.
    check('stage A is offered first', stageList[0]?.stage_key === 'A_identity', JSON.stringify(stageList[0] ?? {}).slice(0, 140));

    // Saving real data through the guided flow must persist and report back.
    const save = await api('/api/stages', {
      method: 'POST',
      body: JSON.stringify({
        entityId,
        stageKey: 'C_about',
        status: 'complete',
        data: { summary: `Smoke test summary written at ${new Date().toISOString()}` },
      }),
    });
    check('stage data saves', save.res.status === 200 && save.body?.ok === true, JSON.stringify(save.body).slice(0, 200));

    const reread = await api(`/api/stages?entityId=${entityId}`);
    const progress = reread.body?.data?.progress ?? reread.body?.stages ?? reread.body?.progress ?? [];
    check('the saved stage appears in progress', progress.length > 0, JSON.stringify(progress).slice(0, 200));
    const savedStage = progress.find?.((p: any) => p.stage_key === 'C_about' || p.stageKey === 'C_about');
    check('the saved stage is complete', savedStage?.status === 'complete', JSON.stringify(savedStage ?? {}).slice(0, 200));
    check('the saved stage kept its data', JSON.stringify(savedStage?.data ?? '').includes('Smoke test summary'), JSON.stringify(savedStage?.data ?? '').slice(0, 160));
  }

  console.log('\n--- 10. unpublished entity website is not served ---');
  if (slug) {
    const site = await api(`/e/${slug}`);
    check('unpublished site returns 404', site.res.status === 404, `got ${site.res.status}`);
    check('unpublished site is marked noindex', String(site.res.headers.get('x-robots-tag') ?? '').includes('noindex'));
  }

  console.log('\n--- 11. maintenance endpoint is protected ---');
  const noSecret = await api('/api/cron?status=1');
  check('cron refuses a call with no secret', noSecret.res.status === 404, `got ${noSecret.res.status}`);
  const wrongSecret = await api('/api/cron?status=1&secret=not-the-secret');
  check('cron refuses a wrong secret', wrongSecret.res.status === 404, `got ${wrongSecret.res.status}`);

  console.log('\n--- 12. publication is refused while blocked ---');
  if (entityId) {
    // A brand-new entity cannot be ready, so publishing must be refused outright.
    const publish = await api('/api/publish', { method: 'POST', body: JSON.stringify({ entityId }) });
    check('publishing a blocked entity is refused', publish.res.status === 409, `got ${publish.res.status}`);
    const refusal = JSON.stringify(publish.body);
    check(
      'the refusal is a readiness refusal',
      publish.body?.error?.domain === 'readiness',
      refusal.slice(0, 200),
    );
    check('the refusal explains what is needed', String(publish.body?.error?.message ?? '').length > 20, String(publish.body?.error?.message));
  }

  console.log('\n--- 13. path traversal is refused ---');
  const traversal = await api('/e/..%2f..%2fpackage.json');
  check('traversal attempt does not return a file', traversal.res.status === 404 || traversal.res.status === 400, `got ${traversal.res.status}`);

  console.log('\n--- 14. sign out ---');
  const logout = await api('/api/auth/logout', { method: 'POST' });
  check('logout succeeds', logout.res.status === 200 || logout.res.status === 204, `got ${logout.res.status}`);
  cookieHeader = '';
  const afterLogout = await api('/app');
  check('session is closed after logout', afterLogout.res.status === 307 || afterLogout.res.status === 302, `got ${afterLogout.res.status}`);

  console.log(`\n========== ${passed} passed, ${failed} failed ==========`);
  if (failures.length > 0) {
    console.log('\nFailures:');
    for (const f of failures) console.log(`  - ${f}`);
  }
  console.log('============================================\n');
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error('\nSMOKE TEST ERROR — the platform could not be reached or crashed:', err);
  process.exit(1);
});

// A module, not a script: without this the top-level helpers share one global
// scope with every other script in the program and collide.
export {};
