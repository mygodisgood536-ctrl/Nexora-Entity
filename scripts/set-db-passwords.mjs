/**
 * One-time: set scram-sha-256 passwords for the superuser and the app role, then verify that
 * password authentication actually works. Used after initial cluster setup.
 */
import { Client } from 'pg';

const HOST = process.env.NEXORA_PG_HOST ?? '127.0.0.1';
const PORT = Number.parseInt(process.env.NEXORA_PG_PORT ?? '5433', 10);

async function main() {
  const admin = new Client({ host: HOST, port: PORT, user: 'postgres', password: 'nexora-entity-super', database: 'postgres' });
  await admin.connect();
  try {
    await admin.query("SET password_encryption = 'scram-sha-256'");
    await admin.query("ALTER ROLE postgres WITH PASSWORD 'nexora-entity-super'");
    await admin.query("ALTER ROLE nexora_entity WITH PASSWORD 'nexora_entity'");
    const ver = await admin.query("SHOW password_encryption");
    console.log(`password_encryption = ${ver.rows[0].password_encryption}`);
  } finally {
    await admin.end();
  }

  // Verify the app role can authenticate with its password against a real database.
  const app = new Client({ host: HOST, port: PORT, user: 'nexora_entity', password: 'nexora_entity', database: 'nexora_entity_dev' });
  await app.connect();
  const who = await app.query('SELECT current_user, current_database()');
  console.log(`verified: ${who.rows[0].current_user}@${who.rows[0].current_database}`);
  await app.end();
}

main().catch((e) => {
  console.error(`failed: ${e?.message ?? e}`);
  process.exit(1);
});