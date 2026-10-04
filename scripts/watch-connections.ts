/**
 * Sample PostgreSQL connection usage while something else runs, to see whether the pool
 * leaks connections or the server is refusing them.
 *
 * Usage: node --import tsx scripts/watch-connections.ts [seconds] [intervalMs]
 */
import { Client } from 'pg';

const SECONDS = Number.parseInt(process.argv[2] ?? '60', 10);
const INTERVAL = Number.parseInt(process.argv[3] ?? '2000', 10);

async function main(): Promise<void> {
  const admin = new Client({
    host: '127.0.0.1',
    port: 5433,
    user: 'nexora_entity',
    password: 'nexora_entity',
    database: 'nexora_entity_dev',
    application_name: 'nexora-connection-watch',
  });
  await admin.connect();

  const max = await admin.query<{ max_connections: string }>('show max_connections');
  console.log(`max_connections = ${max.rows[0]?.max_connections}`);
  console.log(`sampling every ${INTERVAL}ms for ${SECONDS}s\n`);
  console.log('time                 total  active  idle  idle-in-tx  waiting  max_age');

  const deadline = Date.now() + SECONDS * 1000;
  let peak = 0;

  while (Date.now() < deadline) {
    try {
      const res = await admin.query<{ state: string | null; n: string; max_age: string }>(
        `select coalesce(state, 'idle') as state, count(*)::text as n,
                (now() - min(backend_start))::text as max_age
           from pg_stat_activity
          where datname = 'nexora_entity_dev'
          group by state`,
      );
      const byState: Record<string, number> = {};
      let maxAge = '0';
      for (const row of res.rows) {
        byState[row.state ?? 'idle'] = Number(row.n);
        maxAge = row.max_age;
      }
      const total = Object.values(byState).reduce((a, b) => a + b, 0);
      peak = Math.max(peak, total);
      console.log(
        `${new Date().toISOString().slice(11, 19)}  ${String(total).padStart(5)}  ${String(
          byState.active ?? 0,
        ).padStart(6)}  ${String(byState.idle ?? 0).padStart(4)}  ${String(
          byState['idle in transaction'] ?? 0,
        ).padStart(11)}  ${String(byState['active'] ?? 0).padStart(7)}  ${maxAge}`,
      );
    } catch (err) {
      console.log(`sample failed: ${err instanceof Error ? err.message : String(err)}`);
    }
    await new Promise((r) => setTimeout(r, INTERVAL));
  }

  console.log(`\npeak concurrent connections: ${peak}`);
  await admin.end();
}

main().catch((err) => {
  console.error('watch failed:', err);
  process.exit(1);
});