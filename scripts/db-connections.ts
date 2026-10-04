/** Inspect live PostgreSQL connection state, to diagnose pool exhaustion. */
import { Client } from 'pg';

async function main(): Promise<void> {
  const c = new Client({
    host: '127.0.0.1',
    port: 5433,
    user: 'nexora_entity',
    password: 'nexora_entity',
    database: 'nexora_entity_dev',
    connectionTimeoutMillis: 8000,
  });

  await c.connect();

  const settings = await c.query<{ name: string; setting: string }>(
    `select name, setting from pg_settings
     where name in ('max_connections','superuser_reserved_connections','log_directory','logging_collector','log_filename')
     order by name`,
  );
  console.log('--- settings ---');
  for (const r of settings.rows) console.log(`  ${r.name} = ${r.setting}`);

  const byState = await c.query<{ state: string; count: string }>(
    `select coalesce(state,'(none)') as state, count(*)::text as count from pg_stat_activity group by state order by count desc`,
  );
  console.log('--- connections by state (all databases) ---');
  for (const r of byState.rows) console.log(`  ${r.state}: ${r.count}`);

  const byApp = await c.query<{ application_name: string; count: string }>(
    `select application_name, count(*)::text as count from pg_stat_activity group by application_name order by count desc`,
  );
  console.log('--- connections by application_name ---');
  for (const r of byApp.rows) console.log(`  ${r.application_name || '(unset)'}: ${r.count}`);

  const detail = await c.query<{
    pid: number;
    application_name: string;
    state: string;
    client_addr: string;
    age: string;
  }>(
    `select pid, application_name, coalesce(state,'(none)') as state,
            coalesce(host(client_addr),'-') as client_addr,
            (now() - backend_start)::text as age
     from pg_stat_activity where datname = 'nexora_entity_dev' order by backend_start`,
  );
  console.log('--- nexora_entity_dev ---');
  for (const r of detail.rows) console.log(`  pid ${r.pid} ${r.application_name || '-'} ${r.state} ${r.client_addr} age ${r.age}`);

  await c.end();
}

main().catch((err) => {
  console.error('db-connections failed:', err instanceof Error ? err.message : err);
  process.exit(1);
});