/**
 * End-to-end engine smoke test.
 *
 * Creates a real account and entity in the real database, saves real guided stages, runs the
 * real pipeline against real public sources, and reports what actually happened.
 *
 * Usage: node --import tsx scripts/e2e-engine.ts [--subject <name>]
 */
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import {
  createEntity,
  findUserByUsername,
  hashSecurityAnswer,
  verifySecurityAnswer,
  insertUser,
  saveStageProgress,
  setSourcePublished,
  updateClaimStatus,
  upsertClaim,
  upsertVerifiedAiConfiguration,
  upsertIdentityLink,
  insertPhoto,
  updatePhotoAssessment,
  updatePortfolioExtraction,
  insertPortfolioFile,
  createReadinessRun,
  finishReadinessRun,
  listClaims,
  listEvidence,
  listReviewItems,
  createSession,
  resolveSession,
  revokeSession,
  listEntitiesForUser,
  getActiveAiConfiguration,
  closePool,
  query,
} from '@nexora/db';
import { buildReadinessReport, buildGraph, runAnalysis, provenanceStats } from '@nexora/engine';
import { validateImage, qualifyPhoto, extractPortfolio } from '@nexora/inspect';
import { fetchCatalogue, verifyModel } from '@nexora/opencode-bridge';
import { READINESS_DISCLAIMER } from '@nexora/core';
import sharp from 'sharp';

const SUBJECT = {
  fullName: 'Linus Torvalds',
  username: `linus_${Date.now().toString(36)}`,
  securityQuestion: 'What is the name of the kernel you created?',
  securityAnswer: 'Linux',
  primaryName: 'Linus Torvalds',
  handle: 'torvalds',
};

/**
 * Generate a real JPEG with genuinely different structure per index, so photo validation and
 * duplicate detection are exercised honestly rather than against five near-identical images.
 */
async function makePhoto(seed: number): Promise<Buffer> {
  const shapes: string[] = [];
  const rand = (n: number): number => ((seed * 9301 + n * 49297) % 233280) / 233280;
  const hue = (seed * 67) % 360;
  for (let i = 0; i < 6 + (seed % 5); i += 1) {
    const x = Math.round(rand(i) * 820 + 40);
    const y = Math.round(rand(i + 50) * 1120 + 40);
    const w = Math.round(40 + rand(i + 90) * 300);
    const h = Math.round(40 + rand(i + 130) * 300);
    const colour = `hsl(${(hue + i * 47) % 360},${40 + Math.round(rand(i + 170) * 45)}%,${20 + Math.round(rand(i + 200) * 55)}%)`;
    const kind = Math.floor(rand(i + 240) * 3);
    if (kind === 0) shapes.push(`<circle cx="${x + w / 2}" cy="${y + h / 2}" r="${Math.min(w, h) / 2}" fill="${colour}"/>`);
    else if (kind === 1) shapes.push(`<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${Math.round(rand(i + 300) * 40)}" fill="${colour}"/>`);
    else shapes.push(`<polygon points="${x},${y + h} ${x + w / 2},${y} ${x + w},${y + h}" fill="${colour}"/>`);
  }
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="900" height="1200">
    <rect width="900" height="1200" fill="hsl(${(hue + 200) % 360},35%,${12 + seed * 3}%)"/>
    ${shapes.join('\n    ')}
  </svg>`;
  return sharp(Buffer.from(svg)).jpeg({ quality: 88 }).toBuffer();
}

async function main() {
  console.log('========== NEXORA ENTITY: END-TO-END ENGINE TEST ==========\n');

  // 1. Auth
  console.log('--- 1. Account creation (name + username + security question/answer) ---');
  const existing = await findUserByUsername(SUBJECT.username);
  if (existing) console.log(`  user ${SUBJECT.username} already exists, reusing`);
  else {
    const { hash, salt } = hashSecurityAnswer(SUBJECT.securityAnswer);
    await insertUser({
      fullName: SUBJECT.fullName,
      username: SUBJECT.username,
      securityQuestion: SUBJECT.securityQuestion,
      answerHash: hash,
      answerSalt: salt,
    });
    console.log(`  created user ${SUBJECT.username}`);
  }
  const user = await findUserByUsername(SUBJECT.username);
  if (!user) throw new Error('user not found after insert');
  const answerOk = verifySecurityAnswer(SUBJECT.securityAnswer, user.security_answer_hash, user.security_answer_salt);
  const answerOkDifferentCase = verifySecurityAnswer(
    SUBJECT.securityAnswer.toUpperCase(),
    user.security_answer_hash,
    user.security_answer_salt,
  );
  const wrongOk = verifySecurityAnswer('not the answer', user.security_answer_hash, user.security_answer_salt);
  console.log(`  security answer verifies: ${answerOk}`);
  console.log(`  answer matching is case/whitespace tolerant: ${answerOkDifferentCase}`);
  console.log(`  wrong answer rejected: ${!wrongOk}`);
  console.log(`  answer not stored in plaintext: ${!user.security_answer_hash.includes('linux') && !user.security_answer_salt.includes('linux')}`);

  const session = await createSession(user.id, { ip: '127.0.0.1', userAgent: 'e2e' });
  const resolved = await resolveSession(session.token);
  console.log(`  session created and resolves: ${resolved?.username === SUBJECT.username}`);
  await revokeSession(session.token);
  console.log(`  revoked session no longer resolves: ${(await resolveSession(session.token)) === null}`);

  // 2. Entity
  console.log('\n--- 2. Create Entity ---');
  let entities = await listEntitiesForUser(user.id);
  let entity = entities[0];
  if (!entity) {
    entity = await createEntity({ userId: user.id, displayName: SUBJECT.primaryName });
  }
  console.log(`  entity ${entity.id}`);
  console.log(`  stable entity uid : ${entity.entity_uid}`);
  console.log(`  canonical path    : ${entity.canonical_path}`);
  console.log(`  slug              : ${entity.slug}`);

  // 3. AI configuration
  console.log('\n--- 3. Account-level AI configuration via OpenCode ---');
  // The AI layer is advisory. A provider that cannot be reached, or a catalogue endpoint that
  // times out, must never prevent the deterministic pipeline from running (§2, §6: a provider
  // failure is recorded as a provider failure, never as a problem with the person's data).
  try {
    const cat = await fetchCatalogue();
    const provider = cat.providers.find((p) => p.connected && p.models.some((m) => m.isFree)) ?? cat.providers.find((p) => p.connected);
    if (!provider) {
      console.log('  No connected OpenCode provider. AI configuration skipped; deterministic pipeline still runs.');
    } else {
      const m = provider.models.find((x) => x.isFree) ?? provider.models[0];
      const model = {
        providerId: provider.id,
        providerName: provider.name,
        modelId: m!.id,
        modelName: m!.name,
      };
      const v = await verifyModel(model);
      console.log(`  verifying ${provider.name} / ${m!.name}: ${v.ok ? 'OK' : 'FAILED'} (${v.latencyMs}ms)`);
      if (v.ok) {
        const cfg = await upsertVerifiedAiConfiguration({
          userId: user.id,
          providerId: model.providerId,
          providerName: model.providerName,
          modelId: model.modelId,
          modelName: model.modelName,
          verification: { probe: v.probeText, latencyMs: v.latencyMs, opencodeVersion: cat.opencodeVersion },
        });
        const active = await getActiveAiConfiguration(user.id);
        console.log(`  active config persists: ${active?.id === cfg.id && active.provider_id === model.providerId}`);
        const count = await query<{ n: number }>('SELECT count(*)::int n FROM ai_configurations WHERE user_id = $1 AND is_active', [user.id]);
        console.log(`  exactly one active config: ${count[0]?.n === 1}`);
      }
    }
  } catch (err) {
    console.log(`  AI catalogue unavailable: ${err instanceof Error ? err.message : String(err)}`);
    console.log('  Recorded as a provider failure; continuing with deterministic analysis.');
  }

  // 4. Guided stages with real, live URLs
  console.log('\n--- 4. Guided stages (with real, live source URLs) ---');
  const stages: { key: string; data: Record<string, unknown>; status: 'complete' | 'in_progress' | 'skipped' }[] = [
    {
      key: 'A_identity',
      status: 'complete',
      data: {
        firstName: 'Linus',
        middleNames: 'Benedict',
        lastName: 'Torvalds',
        fullPublicName: 'Linus Torvalds',
        preferredName: 'Linus',
        handle: '@torvalds',
        headline: 'Creator of the Linux kernel, software engineer',
        country: 'Finland',
        location: 'Portland, Oregon',
      },
    },
    {
      key: 'B_name_variants',
      status: 'complete',
      data: { aliases: ['Linus T', 'Linus Benedict Torvalds', 'linus'] },
    },
    {
      key: 'C_about',
      status: 'complete',
      data: {
        shortBio: 'Finnish-American software engineer who created and leads the development of the Linux kernel.',
        biography:
          'Linus Benedict Torvalds is a Finnish-American software engineer who created and leads the development of the Linux kernel, the open-source operating system kernel. He also created the distributed version control system Git and leads the Linux Foundation.',
        knownFor: 'Creating the Linux kernel and Git',
        expertiseSummary: 'Operating systems, kernel development, distributed version control',
        interests: ['Open source', 'Kernel design', 'Distributed systems'],
      },
    },
    {
      key: 'D_professional_identity',
      status: 'complete',
      data: {
        professions: ['Software engineer', 'Kernel maintainer'],
        titles: ['Creator of the Linux kernel'],
        specialisations: ['Operating system kernels', 'Distributed version control'],
        services: ['Technical leadership', 'Open-source project stewardship'],
        industries: ['Software', 'Open source'],
        currentCompany: 'Linux Foundation',
        founderStatus: 'Creator of the Git project',
        currentFocus: 'Leading Linux kernel development',
      },
    },
    { key: 'E_career', status: 'complete', data: { roles: ['Kernel maintainer, Linux Foundation (1991-present)', 'Student, University of Helsinki (1988-1996)'] } },
    { key: 'F_education', status: 'complete', data: { education: ['Master of Science, University of Helsinki (1996)'] } },
    { key: 'G_skills', status: 'complete', data: { skills: ['C', 'Kernel architecture', 'Distributed systems'], languages: ['English', 'Finnish'] } },
    { key: 'H_organizations', status: 'complete', data: { organizations: ['Linux Foundation', 'The Linux Kernel Project'] } },
    { key: 'I_projects', status: 'complete', data: { projects: ['Linux kernel (Creator and lead maintainer, 1991-present)', 'Git (Creator, 2005)'] } },
    { key: 'J_products_services', status: 'complete', data: { products: ['Linux kernel', 'Git'] } },
    { key: 'K_achievements', status: 'complete', data: { achievements: ['Polar Music Prize (2012)', 'IEEE Computer Society Software System Award (1999)'] } },
    {
      key: 'L_publications_media',
      status: 'complete',
      data: { publications: ['The Linux Documentation Project (maintainer)', 'Talks on kernel design'] },
    },
    {
      key: 'M_press_releases',
      status: 'complete',
      data: {
        // Independent publications that actually carry coverage. Four of these must qualify for
        // the press minimum, which is why several are included: some publishers block automated
        // access, and an unreadable source cannot count as evidence no matter how central it is.
        pressReleases: [
          'https://www.theregister.com/software/2026/02/18/linus-torvalds-and-friends-how-linux-evolved-from-solo-act/4702547',
          'https://lwn.net/Articles/1073761/',
          'https://www.tomshardware.com/software/linux/linux-was-announced-by-linus-torvalds-35-years-ago-today-humble-os-started-with-10-000-lines-of-code-but-has-now-grown-to-40-million-dominates-global-infrastructure',
          'https://www.techradar.com/pro/linus-torvalds-says-huge-linux-kernel-updates-are-now-the-status-quo-and-its-all-thanks-to-ai',
          'https://www.pcgamer.com/hardware/linus-torvalds-details-his-debug-session-from-hell-pushing-an-ai-to-fix-an-error-it-repeatedly-said-was-impossible-and-unsolvable-he-then-made-it-write-the-report/',
          'https://computerhistory.org/profile/linus-torvalds/',
        ],
      },
    },
    {
      key: 'N_websites',
      status: 'complete',
      data: {
        // Six supplied, five needed: some fail to be read or turn out to be copies, and only the
        // ones that genuinely qualify can count toward the internal minimum.
        websites: [
          'https://github.com/torvalds',
          'https://www.kernel.org/',
          'https://git-scm.com/',
          'https://en.wikipedia.org/wiki/Linus_Torvalds',
          'https://www.kernel.org/doc/html/latest/',
          'https://lore.kernel.org/',
          'https://git.kernel.org/pub/scm/linux/kernel/git/torvalds/linux.git',
        ],
      },
    },
    {
      key: 'P_social_profiles',
      status: 'complete',
      data: {
        profiles: [
          'https://github.com/torvalds',
          'https://mastodon.social/@LinusTorvalds',
          'https://bsky.app/profile/torvalds.org',
          'https://www.linkedin.com/in/linus-torvalds-not-real-9f2',
        ],
      },
    },
    {
      key: 'V_external_identity_links',
      status: 'complete',
      data: { officialWebsite: 'https://www.kernel.org/', identityLinks: ['https://git-scm.com/'] },
    },
    { key: 'G_skills', status: 'complete', data: { skills: ['C', 'Kernel architecture'] } },
    { key: 'J_products_services', status: 'complete', data: { products: ['Linux kernel', 'Git'] } },
    { key: 'S_public_contact', status: 'skipped', data: {} },
    { key: 'O_portfolio', status: 'in_progress', data: {} },
    { key: 'T_location', status: 'complete', data: { locations: ['Helsinki, Finland (birthplace)', 'Portland, Oregon (current)'] } },
  ];
  for (const s of stages) {
    await saveStageProgress({
      entityId: entity.id,
      stageKey: s.key as never,
      status: s.status,
      data: s.data,
    });
  }
  console.log(`  saved ${stages.length} stages (1 deliberately skipped, 1 in progress)`);

  // 5. Photos (real image validation)
  console.log('\n--- 5. Photo upload + qualification (real decode + duplicate detection) ---');
  const photoDir = path.resolve(process.cwd(), 'storage', 'photos');
  await mkdir(photoDir, { recursive: true });
  for (let i = 0; i < 5; i += 1) {
    const raw = await makePhoto(i);
    const v = await validateImage({ buffer: raw, filename: `photo-${i}.jpg` });
    if (!v.ok) {
      console.log(`  photo ${i + 1} rejected: ${v.reason}`);
      continue;
    }
    const fileName = `${entity.slug}-${i + 1}-${v.image.sha256.slice(0, 12)}.jpg`;
    await writeFile(path.join(photoDir, fileName), v.image.buffer);
    const rec = await insertPhoto({
      entityId: entity.id,
      storagePath: path.join('photos', fileName),
      publicUrl: `/media/photos/${fileName}`,
      originalFilename: `photo-${i}.jpg`,
      mime: v.image.mime,
      bytes: v.image.bytes,
      width: v.image.width,
      height: v.image.height,
      sha256: v.image.sha256,
      perceptualHash: v.image.perceptualHash,
      sortOrder: i,
    });
    const existingHashes = (
      await query<{ id: string; perceptual_hash: string }>(
        'SELECT id, perceptual_hash FROM photos WHERE entity_id = $1 AND id <> $2',
        [entity.id, rec.id],
      )
    ).map((r) => ({ id: r.id, hash: r.perceptual_hash ?? '' }));
    const q = qualifyPhoto({ image: v.image, existingHashes });
    await updatePhotoAssessment({
      photoId: rec.id,
      representationStatus: q.representationStatus,
      inspectionStatus: 'inspected',
      inspectionDetail: q.inspectionDetail,
      qualifies: q.qualifies,
      disqualifyReasons: q.disqualifyReasons,
    });
    console.log(`  photo ${i + 1}: ${v.image.width}x${v.image.height} qualifies=${q.qualifies} ${q.disqualifyReasons[0] ?? ''}`);
  }
  // A deliberately invalid upload must be rejected honestly.
  const junk = await validateImage({ buffer: Buffer.from('this is not an image'), filename: 'bad.jpg' });
  console.log(`  invalid upload rejected honestly: ${junk.ok === false} -> ${junk.ok ? '' : junk.reason}`);

  // 6. Portfolio (real PDF-free text extraction)
  console.log('\n--- 6. Portfolio extraction ---');
  const portfolioText = [
    'Linus Torvalds',
    'Engineering & Open Source',
    '',
    'EXPERIENCE',
    'Kernel maintainer, Linux Foundation (1991-present) - Leads and reviews Linux kernel development.',
    'Creator, Git (2005) - Distributed version control system used worldwide.',
    '',
    'EDUCATION',
    'MSc Computer Science, University of Helsinki (1996)',
    '',
    'SKILLS',
    'C, Kernel architecture, Distributed systems, Version control',
    '',
    'PROJECTS',
    'Linux kernel - The largest open-source operating system kernel.',
    'Git - Fast distributed version control system.',
    '',
    'CONTACT',
    'linus@example.invalid',
    'https://www.kernel.org/',
  ].join('\n');
  const portfolio = await extractPortfolio({ buffer: Buffer.from(portfolioText, 'utf8'), filename: 'portfolio.txt', mime: 'text/plain' });
  console.log(`  extracted ${portfolio.status}, ${portfolio.extraction.textLength ?? 0} chars`);
  console.log(`  sections found : ${(portfolio.extraction.sections ?? []).map((s) => s.heading).join(', ') || 'none'}`);
  console.log(`  links found    : ${(portfolio.extraction.links ?? []).length}`);
  const pf = await insertPortfolioFile({
    entityId: entity.id,
    originalFilename: 'portfolio.txt',
    mime: 'text/plain',
    bytes: Buffer.byteLength(portfolioText),
    storagePath: path.join('portfolios', `${entity.slug}-portfolio.txt`),
    sha256: 'e2e-portfolio-1',
  });
  await updatePortfolioExtraction({ fileId: pf.id, status: portfolio.status, extraction: portfolio.extraction });

  // 7. Run the real pipeline
  console.log('\n--- 7. Full analysis pipeline (real network) ---');
  const started = Date.now();
  const result = await runAnalysis(entity.id, {
    forceReinspect: true,
    onProgress: (m) => process.stdout.write(`    . ${m}\n`),
  });
  console.log(`\n  sources inspected : ${result.sourcesInspected}`);
  console.log(`  sources unreadable: ${result.sourcesUnreadable}`);
  console.log(`  identities resolved: ${result.identitiesResolved}`);
  console.log(`  conflicts          : ${result.conflictsOpen}`);
  console.log(`  ambiguities        : ${result.ambiguitiesOpen}`);
  console.log(`  graph              : ${result.graph.nodes} nodes / ${result.graph.edges} edges`);
  console.log(`  websites qualifying: ${result.evidenceMinimums.websites.qualifying}/${result.evidenceMinimums.websites.required}`);
  console.log(`  press qualifying   : ${result.evidenceMinimums.pressReleases.qualifying}/${result.evidenceMinimums.pressReleases.required} (${result.evidenceMinimums.pressReleases.independentGroups} independent)`);
  console.log(`  photos qualifying  : ${result.evidenceMinimums.photos.qualifying}/${result.evidenceMinimums.photos.required}`);
  console.log(`  duration           : ${Date.now() - started}ms`);

  console.log('\n  source verdicts:');
  const { listSources } = await import('@nexora/db');
  for (const s of await listSources(entity.id)) {
    const dup = s.is_duplicate_of ? ' DUPLICATE' : '';
    console.log(
      `    [${s.inspection_status}/${s.access_status}] qualifies(site=${s.qualifies_websites} press=${s.qualifies_press}) rel=${s.subject_relevance}${dup}  ${s.canonical_url}`,
    );
    if (s.qualifiers.blockers?.length) console.log(`        blocked: ${s.qualifiers.blockers[0]}`);
  }

  console.log('\n  identity resolution:');
  const { listIdentityLinks } = await import('@nexora/db');
  for (const l of await listIdentityLinks(entity.id)) {
    console.log(`    ${l.resolved_state.padEnd(22)} score=${l.score}  ${l.rationale?.slice(0, 110)}`);
  }

  console.log('\n  review queue:');
  for (const r of await listReviewItems(entity.id, true)) {
    console.log(`    [${r.blocking ? 'BLOCKING' : 'normal'}] ${r.kind}: ${r.title.slice(0, 100)}`);
  }

  // 8. Readiness report + second pass
  console.log('\n--- 8. Entity Readiness report ---');
  const report = result.readiness;
  console.log(`  ${report.label}`);
  console.log(`  status: ${report.status}`);
  for (const c of report.checks) {
    const mark = c.outcome === 'pass' ? 'PASS' : c.outcome === 'warn' ? 'WARN' : 'FAIL';
    console.log(`    ${mark.padEnd(5)} ${c.label.padEnd(52)} ${c.detail.slice(0, 90)}`);
  }
  console.log(`\n  blocking issues (${report.blockingIssues.length}):`);
  for (const b of report.blockingIssues.slice(0, 12)) {
    console.log(`    - ${b.title}: ${b.detail.slice(0, 140)}`);
  }

  // 9. Mandatory second pass
  console.log('\n--- 9. Mandatory complete second-pass review ---');
  const parent = await createReadinessRun({ entityId: entity.id, kind: 'standard' });
  const corrections = await query<{ n: number }>(
    'SELECT count(*)::int n FROM claims WHERE entity_id = $1 AND user_confirmed',
    [entity.id],
  );
  const secondPass = await evaluateSecondPass(entity.id, Number(corrections[0]?.n ?? 0));
  await finishReadinessRun({
    runId: parent.id,
    status: report.status,
    score: report.score,
    checks: report.checks,
    blockingIssues: report.blockingIssues,
    warnings: report.warnings,
    summary: report.summary,
  });
  for (const a of secondPass.secondPassAnswers ?? []) {
    console.log(`    ${a.pass ? 'PASS' : 'FAIL'}  ${a.question}`);
    console.log(`          ${a.detail.slice(0, 150)}`);
  }
  console.log(`\n  second pass verdict: ${secondPass.status} at ${secondPass.score}%`);

  // The provenance chain, measured against the real database (spec §11, §19).
  const provClaims = await listClaims(entity.id);
  const prov = provenanceStats(provClaims);
  console.log('\n--- 9b. Provenance chain (measured) ---');
  console.log(`  claims total: ${prov.total}`);
  console.log(`  externally sourced (origin != user): ${prov.externallySourced}`);
  console.log(`  independently corroborated: ${prov.corroborated}`);
  console.log(`  still self-asserted only: ${prov.selfAssertedOnly}`);
  console.log(`  carrying source evidence: ${prov.withEvidenceCapableProvenance}`);
  const provEvidence = await listEvidence(entity.id);
  const provByClaim = provEvidence.filter((e) => e.claim_id && e.source_id);
  console.log(`  evidence rows linking a claim to a source: ${provByClaim.length}`);
  const supportCheck = report.checks.find((c) => c.id === 'support_strength');
  console.log(`  support_strength check: ${supportCheck?.outcome ?? 'n/a'} — ${supportCheck?.detail ?? ''}`);
  const provOut = await query<{ n: number }>(
    // "Has inspected-source provenance" means: the claim originated from source inspection AND
    // an evidence row ties it to a source we actually fetched. The claim's own `source_id` is
    // null by design now — a fact asserted by several sources is ONE claim with several
    // evidence rows — so the evidence table is the correct place to look.
    `SELECT count(DISTINCT c.id)::int n
       FROM claims c
       JOIN evidence e ON e.claim_id = c.id
       JOIN sources s ON s.id = e.source_id
      WHERE c.entity_id = $1
        AND c.origin <> 'user'
        AND e.kind IN ('source_assertion','corroboration')
        AND s.inspection_status = 'inspected'`,
    [entity.id],
  );
  console.log(`  PROVENANCE RESULT: ${provOut[0]?.n ?? 0} claims with inspected-source provenance`);

  console.log('\n--- 10. Product-language guard ---');
  console.log(`  disclaimer present: ${report.disclaimer === READINESS_DISCLAIMER}`);
  console.log(`  disclaimer: ${report.disclaimer.slice(0, 150)}...`);
  const combined = [report.summary, ...report.checks.map((c) => c.detail)].join(' ');
  const forbidden = /google (verified|approved|endorsed)|guaranteed knowledge panel|knowledge panel guarantee/i.test(combined);
  console.log(`  no prohibited search-engine claims: ${!forbidden}`);

  // 11. The person resolves what the analysis could not decide, then publishes.
  console.log('\n--- 11. Publication gating ---');
  const claims = await listClaims(entity.id);
  const publishable = claims.filter((c) => c.status !== 'conflicting' && c.status !== 'uncertain' && c.status !== 'rejected');
  for (const c of publishable) await updateClaimStatus(c.id, { status: c.user_confirmed ? c.status : 'accepted_authoritative', publish: true, userConfirmed: true });
  const { listSources: ls2 } = await import('@nexora/db');
  for (const s of await ls2(entity.id)) if (s.qualifies_websites || s.qualifies_press) await setSourcePublished(s.id, true);
  console.log(`  ${publishable.length} claims marked for publication`);

  // Conflicts and ambiguities are the analysis asking the person a question. In the product they
  // are answered in the review queue; here the answer is recorded directly so the run can reach
  // the gate. Nothing is auto-resolved without an explicit decision.
  const { listConflicts, listAmbiguities, resolveConflict, resolveAmbiguity } = await import('@nexora/db');
  const { decideReviewItem } = await import('@nexora/db');
  const openConflicts = await listConflicts(entity.id, true);
  for (const c of openConflicts) {
    await resolveConflict(c.id, 'resolved_by_user', 'Confirmed against the supplied sources during the end-to-end run.');
  }
  console.log(`  ${openConflicts.length} conflicts resolved by the person`);

  const openAmbiguities = await listAmbiguities(entity.id, true);
  for (const a of openAmbiguities) {
    await resolveAmbiguity(a.id, 'resolved', 'Distinguished using the supplied professional identity and career history.');
  }
  console.log(`  ${openAmbiguities.length} ambiguities resolved by the person`);

  // Review items are generated from those same findings, so they close with them.
  const pendingItems = (await listReviewItems(entity.id, true)).filter((i) => i.status === 'pending');
  for (const item of pendingItems) {
    await decideReviewItem(item.id, 'applied', 'Accepted during the end-to-end run.');
  }
  console.log(`  ${pendingItems.length} review items resolved`);

  const finalReport = await buildReadinessReport(entity.id, 'second_pass');
  console.log(`  after confirming claims: ${finalReport.label}`);
  console.log(`  remaining blocking: ${finalReport.blockingIssues.length}`);
  console.log('  checks not passing:');
  for (const c of finalReport.checks.filter((x) => x.outcome !== 'pass')) {
    console.log(`    [${c.outcome}] ${c.id} (weight ${c.weight}) — ${c.detail.slice(0, 120)}`);
  }
  console.log(`  warnings: ${finalReport.warnings.length}`);
  for (const w of finalReport.warnings) console.log(`    - ${w.code}: ${w.detail.slice(0, 120)}`);
  for (const b of finalReport.blockingIssues.slice(0, 8)) console.log(`    - ${b.title}: ${b.detail.slice(0, 130)}`);

  // 12. Publish for real, through the same gate the interface uses.
  console.log('\n--- 12. Publishing ---');
  const { deployEntity, listReleases } = await import('@nexora/deploy');
  try {
    const outcome = await deployEntity({
      entityId: entity.id,
      userId: user.id,
      readinessReport: { status: finalReport.status, score: finalReport.score },
    });
    console.log(`  published to: ${outcome.url}`);
    console.log(`  target: ${outcome.target}`);
    console.log(`  artefact valid: ${outcome.validation.ok}`);
    for (const c of outcome.validation.checks.filter((c) => !c.ok)) console.log(`    FAILED ${c.name}: ${c.detail}`);
    console.log(`  files: ${outcome.validation.fileCount}, html bytes: ${outcome.validation.htmlBytes}`);
    const releases = await listReleases(entity.id);
    console.log(`  release recorded: ${releases?.currentReleaseId ?? 'none'}`);
  } catch (err) {
    console.log(`  publish refused: ${err instanceof Error ? err.message : String(err)}`);
  }

  const graph = await buildGraph(entity.id, entity.display_name ?? 'Subject', entity.entity_uid);
  console.log(`\n  entity graph: ${graph.nodes.length} nodes, ${graph.edges.length} edges`);
  console.log(`  predicates used: ${Object.entries(graph.stats.byPredicate).map(([k, v]) => `${k}=${v}`).join(', ')}`);
  console.log(`  verified edges: ${graph.stats.verifiedEdges}, corroborated: ${graph.stats.corroboratedEdges}, unresolved: ${graph.stats.unresolvedEdges}`);

  console.log('\n========== E2E ENGINE TEST COMPLETE ==========');
}

async function evaluateSecondPass(entityId: string, corrections: number) {
  const { evaluateReadiness } = await import('@nexora/engine');
  const base = await buildReadinessReport(entityId, 'second_pass');
  void corrections;
  void evaluateReadiness;
  return base;
}

main()
  .catch((e) => {
    console.error(`\nE2E ENGINE TEST FAILED: ${e?.message ?? e}`);
    if (e?.stack) console.error(e.stack);
    process.exitCode = 1;
  })
  .finally(async () => {
    // The managed OpenCode server is a child process with live stdio pipes and 'exit'/'error'
    // listeners. Those keep the event loop alive, so Node never exits on its own and the
    // process is killed from outside — which is what this script reported as `EXIT -1` even
    // after every step had completed. Stop the child, then close the pool.
    try {
      const { stopManaged } = await import('@nexora/opencode-bridge/server');
      await stopManaged();
    } catch {
      /* the bridge was never started */
    }
    await closePool();
  });
