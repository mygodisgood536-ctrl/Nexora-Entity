/**
 * Readiness blocker diagnostics.
 *
 * When an entity is blocked, the useful question is not "what is the score" but "which
 * specific item is stopping it, where did it come from, and what would resolve it". This
 * prints exactly that, straight from the database, so the reason is never guessed at.
 *
 * Usage: node --import tsx scripts/readiness-report.ts [--entity <id>] [--json]
 */
import { query, closePool } from '@nexora/db';
import { buildReadinessReport as buildReport } from '@nexora/engine';

const args = process.argv.slice(2);
const entityFlagIdx = args.indexOf('--entity');
const requestedEntityId: string | null = entityFlagIdx >= 0 ? args[entityFlagIdx + 1] ?? null : null;
const asJson = args.includes('--json');

interface Row {
  [k: string]: unknown;
}

async function latestEntityId(): Promise<string | null> {
  const rows = await query<Row>(
    `SELECT id, display_name, entity_uid FROM entities ORDER BY created_at DESC LIMIT 1`,
  );
  return rows[0]?.['id'] as string | undefined ?? null;
}

async function main(): Promise<void> {
  const id = requestedEntityId ?? (await latestEntityId());
  if (!id) {
    console.log('No entities found.');
    return;
  }

  const [entity] = await query<Row>(`SELECT id, display_name, entity_uid FROM entities WHERE id = $1`, [id]);
  console.log(`\n=== ENTITY ${entity?.['display_name']} (${id}) ===\n`);

  // ── Ambiguity ───────────────────────────────────────────────────────────────
  const ambiguities = await query<Row>(
    `SELECT id, dimension, severity, status, description, missing_evidence, candidates
       FROM ambiguities WHERE entity_id = $1 AND status = 'open' ORDER BY severity, dimension`,
    [id],
  );
  console.log(`--- OPEN AMBIGUITIES (${ambiguities.length}) ---`);
  for (const a of ambiguities) {
    console.log(`  [${a.severity}] ${a.dimension}`);
    console.log(`    ${a.description}`);
    console.log(`    candidates: ${JSON.stringify(a.candidates)}`);
    console.log(`    missing  : ${JSON.stringify(a.missing_evidence)}`);
  }
  console.log('');

  // ── Conflicts ───────────────────────────────────────────────────────────────
  const conflicts = await query<Row>(
    `SELECT id, attribute_key, kind, severity, claim_ids, source_ids, description, user_message, evidence
       FROM conflicts WHERE entity_id = $1 AND status = 'open' ORDER BY attribute_key, kind`,
    [id],
  );
  console.log(`--- OPEN CONFLICTS (${conflicts.length}) ---`);
  const byKind = new Map<string, Row[]>();
  for (const c of conflicts) {
    const k = String(c.kind);
    if (!byKind.has(k)) byKind.set(k, []);
    byKind.get(k)!.push(c);
  }
  for (const [kind, list] of byKind) {
    console.log(`  kind=${kind} (${list.length})`);
    for (const c of list.slice(0, 4)) {
      console.log(`    attribute : ${c.attribute_key}`);
      console.log(`    severity  : ${c.severity}`);
      console.log(`    message   : ${c.user_message}`);
      console.log(`    evidence  : ${JSON.stringify(c.evidence)}`);
    }
    if (list.length > 4) console.log(`    ... and ${list.length - 4} more`);
  }
  console.log('');

  // The actual claim values behind the conflicts, so classification is not guesswork.
  if (conflicts.length > 0) {
    const claimIds = conflicts.flatMap((c) => (c.claim_ids as string[] | null) ?? []);
    if (claimIds.length > 0) {
      const claims = await query<Row>(
        `SELECT id, attribute_key, value_text, status, origin, support_strength,
                period_start, period_end, is_current, independence_group, source_id
           FROM claims WHERE id = ANY($1::uuid[]) ORDER BY attribute_key`,
        [claimIds],
      );
      console.log(`--- CLAIMS INVOLVED IN CONFLICTS (${claims.length}) ---`);
      for (const c of claims) {
        console.log(
          `  ${c.attribute_key} = "${String(c.value_text).slice(0, 70)}" ` +
          `[${c.status}/${c.origin}/${c.support_strength}] ` +
          `period=${c.period_start ?? '-'}..${c.period_end ?? '-'} current=${c.is_current} grp=${c.independence_group ?? '-'}`,
        );
      }
      console.log('');
    }
  }

  // ── Review queue ────────────────────────────────────────────────────────────
  const reviews = await query<Row>(
    `SELECT id, kind, title, detail, blocking, status, proposed, conflict_id
       FROM review_items WHERE entity_id = $1 AND status = 'pending' ORDER BY blocking DESC, created_at`,
    [id],
  );
  console.log(`--- PENDING REVIEW ITEMS (${reviews.length}) ---`);
  for (const r of reviews) {
    console.log(`  [${r.blocking ? 'BLOCKING' : 'normal'}] ${r.kind}: ${r.title}`);
    console.log(`    detail: ${r.detail}`);
    console.log(`    proposed: ${JSON.stringify(r.proposed)}`);
  }
  console.log('');

  // ── Readiness ───────────────────────────────────────────────────────────────
  const report = await buildReport(id, 'second_pass');
  console.log('--- READINESS ---');
  console.log(`  ${report.label} (${report.status})`);
  for (const c of report.checks.filter((x) => x.outcome !== 'pass')) {
    console.log(`  [${c.outcome}] ${c.id} (w${c.weight}) — ${c.detail}`);
  }
  console.log(`  blockingIssues: ${report.blockingIssues.length}`);
  for (const b of report.blockingIssues) console.log(`    - ${b.title}: ${b.detail}`);

  if (asJson) {
    console.log(JSON.stringify({ ambiguities, conflicts, reviews, report }, null, 2));
  }
}

main()
  .catch((e) => {
    console.error('readiness-report failed:', e instanceof Error ? e.message : e);
    process.exitCode = 1;
  })
  .finally(() => closePool());
