/**
 * Provision the Nexora Entity role and databases using the pg driver directly.
 * Idempotent. Requires only the local superuser credentials (no psql binary needed).
 */
import { Client } from 'pg';

const HOST = process.env.NEXORA_PG_HOST ?? '127.0.0.1';
const PORT = Number.parseInt(process.env.NEXORA_PG_PORT ?? '5433', 10);
const SUPERUSER = process.env.NEXORA_PG_SUPERUSER ?? 'postgres';
const SUPERPASS = process.env.NEXORA_PG_SUPERPASS ?? 'nexora-entity-super';
const APP_USER = 'nexora_entity';
const APP_PASS = 'nexora_entity';
const DATABASES = ['nexora_entity_dev', 'nexora_entity_test'];

async function connect(db) {
  const client = new Client({ host: HOST, port: PORT, user: SUPERUSER, password: SUPERPASS, database: db });
  await client.connect();
  return client;
}

async function main() {
  const admin = await connect('postgres');
  try {
    // Credentials must be stored as SCRAM-SHA-256, which is what pg_hba.conf requires.
    // Without this, an ALTER ROLE would silently store an MD5 hash and authentication would break.
    await admin.query("SET password_encryption = 'scram-sha-256'");
    const role = await admin.query('SELECT 1 FROM pg_roles WHERE rolname = $1', [APP_USER]);
    if (role.rowCount === 0) {
      await admin.query(`CREATE ROLE ${APP_USER} WITH LOGIN PASSWORD '${APP_PASS}'`);
      console.log(`created role ${APP_USER}`);
    } else {
      await admin.query(`ALTER ROLE ${APP_USER} WITH LOGIN PASSWORD '${APP_PASS}'`);
      console.log(`role ${APP_USER} already present — password refreshed`);
    }

    for (const db of DATABASES) {
      const exists = await admin.query('SELECT 1 FROM pg_database WHERE datname = $1', [db]);
      if (exists.rowCount === 0) {
        await admin.query(`CREATE DATABASE ${db} OWNER ${APP_USER}`);
        console.log(`created database ${db}`);
      } else {
        console.log(`database ${db} already exists`);
      }
      const onDb = await connect(db);
      try {
        await onDb.query(`ALTER SCHEMA public OWNER TO ${APP_USER}`);
        await onDb.query(`GRANT ALL ON SCHEMA public TO ${APP_USER}`);
      } finally {
        await onDb.end();
      }
    }
  } finally {
    await admin.end();
  }
  console.log('\nProvisioned. Connection strings:');
  console.log(`  dev : postgres://${APP_USER}:${APP_PASS}@${HOST}:${PORT}/nexora_entity_dev`);
  console.log(`  test: postgres://${APP_USER}:${APP_PASS}@${HOST}:${PORT}/nexora_entity_test`);
}

main().catch((err) => {
  console.error(`provision failed: ${err?.message ?? err}`);
  console.error('Is PostgreSQL running? Start it with: npm run db:start');
  process.exit(1);
});