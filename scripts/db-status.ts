/** Verify the database is reachable and the schema is fully present. */
import { closePool, query } from '@nexora/db';

const EXPECTED = [
  'users','auth_sessions','auth_attempts','entities','ai_configurations','ai_provider_attempts',
  'opencode_snapshots','stage_progress','sources','photos','portfolio_files','claims','evidence',
  'identity_links','conflicts','ambiguities','review_items','readiness_runs','evidence_minimums',
  'domains','deployments','revalidation_jobs','audit_log','platform_settings',
];

async function main() {
  const rows = await query<{ table_name: string }>(
    "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' ORDER BY table_name",
  );
  const present = new Set(rows.map((r) => r.table_name));
  const missing = EXPECTED.filter((t) => !present.has(t));

  const applied = await query<{ filename: string; applied_at: Date }>(
    'SELECT filename, applied_at FROM public.schema_migrations ORDER BY filename',
  );

  const counts: Record<string, number> = {};
  for (const t of EXPECTED) {
    if (!present.has(t)) continue;
    const r = await query<{ n: number }>(`SELECT count(*)::int AS n FROM public.${t}`);
    counts[t] = r[0]?.n ?? 0;
  }

  console.log('Database:', process.env.DATABASE_URL ?? '(default)');
  console.log(`Tables present: ${present.size}/${EXPECTED.length}`);
  if (missing.length) {
    console.error(`MISSING TABLES: ${missing.join(', ')}`);
    process.exitCode = 1;
  }
  console.log('Migrations:', applied.map((a) => `${a.filename} @ ${new Date(a.applied_at).toISOString()}`).join(', '));
  console.log('Row counts:', JSON.stringify(counts));
  if (missing.length === 0) console.log('OK — schema complete.');
}

main()
  .catch((e) => {
    console.error(`db check failed: ${e?.message ?? e}`);
    process.exitCode = 1;
  })
  .finally(() => closePool());