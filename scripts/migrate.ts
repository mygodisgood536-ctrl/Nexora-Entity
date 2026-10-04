/**
 * Migration runner. Applies every unapplied file in packages/db/migrations in order.
 * Each file runs inside a transaction and is recorded in schema_migrations.
 */
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getPool, query, closePool } from '@nexora/db';

const here = path.dirname(fileURLToPath(import.meta.url));
const migrationsDir = path.resolve(here, '..', 'packages', 'db', 'migrations');

async function ensureTable(): Promise<void> {
  await query(`
    CREATE TABLE IF NOT EXISTS public.schema_migrations (
      filename   text PRIMARY KEY,
      checksum   text NOT NULL,
      applied_at timestamptz NOT NULL DEFAULT now()
    )`);
}

function checksum(text: string): string {
  let h = 0;
  for (let i = 0; i < text.length; i += 1) h = (h * 31 + text.charCodeAt(i)) | 0;
  return `c${(h >>> 0).toString(16)}-${text.length}`;
}

export async function runMigrations(): Promise<{ applied: string[]; skipped: string[] }> {
  await ensureTable();
  const applied = new Set(
    (await query<{ filename: string }>('SELECT filename FROM public.schema_migrations')).map((r) => r.filename),
  );
  const files = (await readdir(migrationsDir)).filter((f) => f.endsWith('.sql')).sort();
  const newly: string[] = [];
  const skipped: string[] = [];
  const pool = getPool();
  for (const file of files) {
    const sql = await readFile(path.join(migrationsDir, file), 'utf8');
    if (applied.has(file)) {
      skipped.push(file);
      continue;
    }
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(sql);
      await client.query('INSERT INTO public.schema_migrations (filename, checksum) VALUES ($1, $2)', [
        file,
        checksum(sql),
      ]);
      await client.query('COMMIT');
      newly.push(file);
      console.log(`applied ${file}`);
    } catch (err) {
      await client.query('ROLLBACK');
      throw new Error(`migration ${file} failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      client.release();
    }
  }
  return { applied: newly, skipped };
}

const isDirect = process.argv[1] && import.meta.url.endsWith(path.basename(process.argv[1]).replace(/\\/g, '/'));
if (isDirect || process.env.NEXORA_MIGRATE_FORCE === '1') {
  runMigrations()
    .then(async (r) => {
      console.log(`\nmigrations complete: ${r.applied.length} applied, ${r.skipped.length} already present`);
      await closePool();
    })
    .catch(async (err) => {
      console.error(err instanceof Error ? err.message : String(err));
      await closePool();
      process.exit(1);
    });
}