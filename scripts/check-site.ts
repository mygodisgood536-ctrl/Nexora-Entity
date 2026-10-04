/**
 * Real check for the Entity Website design system and the deployment pipeline.
 *
 * Builds an artefact from real database state, validates it, renders it, and writes it out.
 * Prints what actually happened.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { listClaims,
  listEntitiesForUser,
  listIdentityLinks,
  listPhotos,
  listSources,
  updateClaimStatus,
  closePool,
} from '@nexora/db';
import { buildArtefact, validateArtefact, chooseTarget, designSystemCss } from '@nexora/deploy';
import { vercelDiagnostics } from '@nexora/deploy';
import { ensurePlatformSubdomain } from '@nexora/deploy';
import { navigationFor } from '@nexora/entity-site/compose';
import { buildMeta } from '@nexora/entity-site/meta';

async function main() {
  console.log('========== DESIGN SYSTEM + DEPLOYMENT CHECK ==========\n');

  // Use the most complete entity in the database.
  const rows = await (await import('@nexora/db')).query<{ id: string; user_id: string; slug: string; display_name: string | null; status: string; updated_at: Date }>(
    `SELECT id, user_id, slug, display_name, status, updated_at FROM entities
      ORDER BY updated_at DESC LIMIT 5`,
  );
  if (rows.length === 0) throw new Error('no entity found. Run the engine e2e test first.');
  const entity = rows[0]!;
  console.log(`entity: ${entity.slug} (${entity.id})`);
  console.log(`display: ${entity.display_name ?? '(none)'}`);

  console.log('\n--- 1. design system stylesheet ---');
  const css = designSystemCss();
  console.log(`  bytes: ${css.length}`);
  console.log(`  has responsive breakpoints: ${/@media\s*\(max-width/.test(css)}`);
  console.log(`  has focus styles: ${/:focus-visible/.test(css)}`);
  console.log(`  has reduced-motion handling: ${/prefers-reduced-motion/.test(css)}`);
  console.log(`  has print styles: ${/@media print/.test(css)}`);

  console.log('\n--- 2. build artefact from real state ---');
  const claims = await listClaims(entity.id);
  // For this check, mark non-conflicting claims publishable so the design system has content.
  const publishable = claims.filter((c) => c.status !== 'conflicting' && c.status !== 'uncertain' && c.status !== 'rejected');
  for (const c of publishable) {
    await updateClaimStatus(c.id, { publish: true, userConfirmed: true });
  }
  console.log(`  ${publishable.length} claims marked publishable`);

  const canonicalUrl = `http://${entity.slug}.nexoraentity.com`;
  const artefact = await buildArtefact({
    entityId: entity.id,
    canonicalUrl,
    mediaBase: 'http://127.0.0.1:4311/media',
    published: false,
  });

  console.log('\n--- 3. composed model ---');
  const m = artefact.model;
  console.log(`  name            : ${m.name}`);
  console.log(`  alternate names : ${m.alternateNames.join(', ') || '(none)'}`);
  console.log(`  headline        : ${m.headline ?? '(none)'}`);
  console.log(`  summary         : ${(m.summary ?? '(none)').slice(0, 110)}`);
  console.log(`  biography       : ${m.biography ? `${m.biography.length} chars` : '(none)'}`);
  console.log(`  primary image   : ${m.primaryImage?.url ?? '(none)'}`);
  console.log(`  gallery         : ${m.gallery.length} image(s)`);
  console.log(`  profiles        : ${m.profiles.length}`);
  console.log(`  websites        : ${m.websites.length}`);
  console.log(`  press           : ${m.press.length}`);
  console.log(`  sections (${m.sections.length}) :`);
  for (const s of m.sections) {
    console.log(`    - ${s.id.padEnd(14)} "${s.title}" ${s.entries.length} entries, nav=${s.navLabel ?? '-'}, emphasis=${s.emphasis}`);
  }
  const nav = navigationFor(m);
  console.log(`  navigation      : ${nav.map((n) => n.label).join(' | ') || '(none)'}`);
  console.log(`  draft warnings  : ${m.draftWarnings.join(' | ') || '(none)'}`);

  console.log('\n--- 4. empty-section / placeholder audit ---');
  const emptySections = m.sections.filter((s) => s.entries.length === 0 && !s.body);
  console.log(`  sections with no content at all: ${emptySections.length} (must be 0)`);
  const html = artefact.html;
  console.log(`  html contains "coming soon":   ${/coming soon/i.test(html)}`);
  console.log(`  html contains "lorem":         ${/lorem/i.test(html)}`);
  console.log(`  html contains "undefined":     ${/>[^<]*undefined[^<]*</.test(html)}`);
  console.log(`  html contains "[object":       ${/\[object Object\]/.test(html)}`);
  console.log(`  html contains "NaN":           ${/\bNaN\b/.test(html)}`);
  console.log(`  html size: ${Buffer.byteLength(html, 'utf8')} bytes`);

  console.log('\n--- 5. structured data ---');
  const meta = buildMeta(m);
  console.log(`  title      : ${meta.title}`);
  console.log(`  description: ${meta.description.slice(0, 130)}`);
  console.log(`  canonical  : ${meta.canonicalUrl}`);
  console.log(`  robots     : ${meta.robots}`);
  console.log(`  og:title   : ${meta.openGraph['og:title']}`);
  console.log(`  og:image   : ${meta.openGraph['og:image'] ?? '(none)'}`);
  console.log(`  json-ld nodes: ${meta.jsonLd.length}`);
  for (const node of meta.jsonLd) {
    const t = node['@type'] as string;
    if (t === 'Person') {
      console.log(`    Person @id           : ${node['@id']}`);
      console.log(`    name                 : ${node['name']}`);
      console.log(`    identifier           : ${node['identifier']}`);
      console.log(`    alternateName        : ${JSON.stringify(node['alternateName'] ?? null)}`);
      console.log(`    jobTitle             : ${node['jobTitle'] ?? '(none)'}`);
      console.log(`    sameAs count         : ${Array.isArray(node['sameAs']) ? node['sameAs'].length : 0}`);
      console.log(`    hasOccupation        : ${JSON.stringify(node['hasOccupation'] ?? null)?.slice(0, 120)}`);
      console.log(`    creates              : ${Array.isArray(node['creates']) ? node['creates'].length : 0}`);
      console.log(`    worksFor             : ${Array.isArray(node['worksFor']) ? node['worksFor'].length : 0}`);
      console.log(`    award                : ${Array.isArray(node['award']) ? node['award'].length : 0}`);
    } else {
      console.log(`    ${t} @id: ${node['@id']}`);
    }
  }

  console.log('\n--- 6. validation ---');
  const validation = validateArtefact(artefact);
  for (const c of validation.checks) {
    console.log(`  ${c.ok ? 'PASS' : 'FAIL'}  ${c.name.padEnd(26)} ${c.detail}`);
  }
  console.log(`  build hash: ${validation.buildHash}`);
  console.log(`  overall   : ${validation.ok ? 'VALID' : 'INVALID'}`);

  console.log('\n--- 7. deployment target (honest) ---');
  const target = chooseTarget();
  console.log(`  chosen target: ${target}`);
  const vd = await vercelDiagnostics();
  console.log(`  vercel configured: ${vd.configured}`);
  console.log(`  vercel reachable : ${vd.reachable}`);
  console.log(`  detail           : ${vd.detail}`);

  console.log('\n--- 8. custom domain plan ---');
  const plan = await ensurePlatformSubdomain(entity.id);
  console.log(`  subdomain: ${plan.hostname}`);
  console.log(`  records  : ${plan.dnsRecords.map((r) => `${r.type} ${r.name} -> ${r.value}`).join(' | ')}`);
  console.log(`  instructions: ${plan.instructions.join(' ')}`);

  console.log('\n--- 9. files written ---');
  const outDir = path.resolve(process.cwd(), 'storage', 'render-check', entity.slug);
  await mkdir(outDir, { recursive: true });
  for (const f of artefact.files) {
    const p = path.join(outDir, f.name);
    await mkdir(path.dirname(p), { recursive: true });
    await writeFile(p, f.contents);
    console.log(`  ${f.name.padEnd(28)} ${String(typeof f.contents === 'string' ? Buffer.byteLength(f.contents) : f.contents.length).padStart(8)} bytes`);
  }
  console.log(`  written to ${outDir}`);

  console.log('\n--- 10. html excerpt (hero) ---');
  const heroStart = html.indexOf('<header');
  console.log(html.slice(heroStart, heroStart + 900).replace(/></g, '>\n<'));

  console.log('\n========== DESIGN SYSTEM + DEPLOYMENT CHECK COMPLETE ==========');
}

main()
  .catch((e) => {
    console.error(`\nCHECK FAILED: ${e?.message ?? e}`);
    if (e?.stack) console.error(e.stack);
    process.exitCode = 1;
  })
  .finally(() => closePool());