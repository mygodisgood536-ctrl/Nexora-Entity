/**
 * Real integration check for the source-inspection layer. Uses live public URLs.
 * Prints what was actually observed, including honest failures.
 */
import { classifySourceType, inspectUrl, qualifySource, assessDuplicate, type SubjectProfile } from '@nexora/inspect';

const SUBJECT: SubjectProfile = {
  names: ['Linus Torvalds', 'Linus'],
  aliases: ['Linus T'],
  professions: ['software engineer', 'kernel maintainer'],
  organizations: ['Linux Foundation', 'Linux'],
  projects: ['Linux kernel', 'Git'],
  locations: ['Helsinki', 'Portland'],
  handle: 'torvalds',
  ownedDomains: ['kernel.org', 'github.com'],
  biography: 'Linus Torvalds is the creator of the Linux kernel.',
};

const URLS: { url: string; kind: string }[] = [
  { url: 'https://github.com/torvalds', kind: 'social_profile' },
  { url: 'https://en.wikipedia.org/wiki/Linus_Torvalds', kind: 'news_article' },
  { url: 'https://www.linkedin.com/in/williamhgates/', kind: 'social_profile' },
  { url: 'https://this-domain-definitely-does-not-exist-9f3a2b.com', kind: 'personal_site' },
  { url: 'https://www.instagram.com/instagram/', kind: 'social_profile' },
];

type Row = Awaited<ReturnType<typeof inspectUrl>> & {
  qualification?: ReturnType<typeof qualifySource>;
  sourceType?: string;
  kind?: string;
};

async function main() {
  const results: Row[] = [];
  for (const { url, kind } of URLS) {
    process.stdout.write(`\n=== ${url}\n`);
    const r = await inspectUrl(url);
    process.stdout.write(`  access        : ${r.accessStatus}${r.httpStatus ? ` (HTTP ${r.httpStatus})` : ''}\n`);
    if (r.accessDetail) process.stdout.write(`  detail        : ${r.accessDetail}\n`);
    process.stdout.write(`  inspected     : ${r.inspected}\n`);
    process.stdout.write(`  platform      : ${r.platform ?? '-'} ${r.platformHandle ?? ''}\n`);
    if (r.platformNote) process.stdout.write(`  platform note : ${r.platformNote.slice(0, 170)}\n`);
    process.stdout.write(`  title         : ${(r.title ?? '-').slice(0, 100)}\n`);
    process.stdout.write(`  names found   : ${r.extracted.names.slice(0, 5).join(' | ') || '-'}\n`);
    process.stdout.write(`  headline      : ${(r.extracted.headline ?? '-').slice(0, 100)}\n`);
    process.stdout.write(`  organisation  : ${r.extracted.organisation ?? '-'}\n`);
    process.stdout.write(`  location      : ${r.extracted.location ?? '-'}\n`);
    process.stdout.write(`  jsonLd types  : ${r.extracted.jsonLdTypes.join(', ') || '-'}\n`);
    process.stdout.write(
      `  images        : ${r.extracted.images.length}, sameAs: ${r.extracted.sameAs.length}, profileLinks: ${r.extracted.profileLinks.length}\n`,
    );
    process.stdout.write(`  text length   : ${r.textLength}\n`);
    process.stdout.write(`  platformData  : ${r.platformData ? Object.keys(r.platformData.facts).join(', ') : '-'}\n`);
    if (r.platformData?.mechanism) process.stdout.write(`  mechanism     : ${r.platformData.mechanism}\n`);

    const sourceType = classifySourceType({ inspection: r, declaredKind: kind });
    const q = qualifySource({ url, inspection: r, sourceType, declaredKind: kind, subject: SUBJECT });
    process.stdout.write(`  sourceType    : ${sourceType}\n`);
    process.stdout.write(`  qualifiesSite : ${q.qualifiesWebsites}\n`);
    process.stdout.write(`  qualifiesPress: ${q.qualifiesPress}\n`);
    process.stdout.write(`  relevance     : ${q.subjectRelevance}  quality: ${q.qualityScore}\n`);
    process.stdout.write(`  assessment    : ${q.assessment}\n`);
    if (q.reasons.length) process.stdout.write(`  reasons       : ${q.reasons.slice(0, 3).join(' | ')}\n`);
    if (q.blockers.length) process.stdout.write(`  blockers      : ${q.blockers.join(' | ')}\n`);
    process.stdout.write(`  indep group   : ${q.independenceGroup}\n`);
    results.push({ ...r, qualification: q, sourceType, kind });
  }

  process.stdout.write('\n=== duplicate / independence detection ===\n');
  const cand = results[0]!;
  const others = results
    .filter((r) => r !== cand && r.inspected)
    .map((r, i) => ({
      id: `other-${i}`,
      url: r.url,
      textExcerpt: r.textExcerpt,
      independenceGroup: r.qualification?.independenceGroup ?? 'x',
      title: r.title,
    }));
  process.stdout.write(
    `  ${JSON.stringify(
      assessDuplicate(
        { id: 'cand', url: cand.url, inspection: cand, independenceGroup: cand.qualification?.independenceGroup ?? 'y' },
        others,
      ),
    )}\n`,
  );

  process.stdout.write('\n=== self-duplicate detection (same content twice) ===\n');
  process.stdout.write(
    `  ${JSON.stringify(
      assessDuplicate({ id: 'a', url: cand.url, inspection: cand, independenceGroup: 'same' }, [
        { id: 'b', url: cand.url, textExcerpt: cand.textExcerpt, independenceGroup: 'same', title: cand.title },
      ]),
    )}\n`,
  );

  process.stdout.write('\nINSPECTION INTEGRATION OK\n');
}

main().catch((e) => {
  process.stdout.write(`INSPECTION INTEGRATION FAILED: ${e?.message ?? e}\n`);
  if (e?.stack) process.stdout.write(`${e.stack}\n`);
  process.exitCode = 1;
});