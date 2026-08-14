import { readFile, readdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import pg from 'pg';
const { Pool } = pg;
if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required');
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const directory = resolve(process.cwd(), '..', 'database', 'migrations');
try {
  await pool.query('CREATE TABLE IF NOT EXISTS schema_migrations (filename text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())');
  const baseline = await pool.query("SELECT to_regclass('public.users') AS users");
  if (baseline.rows[0]?.users) await pool.query("INSERT INTO schema_migrations(filename) VALUES('001_initial_schema.sql') ON CONFLICT DO NOTHING");
  const applied = new Set((await pool.query('SELECT filename FROM schema_migrations')).rows.map((row) => row.filename));
  const files = (await readdir(directory)).filter((file) => file.endsWith('.sql')).sort();
  for (const filename of files) {
    if (applied.has(filename)) continue;
    const client = await pool.connect();
    try { await client.query('BEGIN'); await client.query(await readFile(join(directory, filename), 'utf8')); await client.query('INSERT INTO schema_migrations(filename) VALUES($1)', [filename]); await client.query('COMMIT'); console.log(`Applied ${filename}`); }
    catch (error) { await client.query('ROLLBACK'); throw error; }
    finally { client.release(); }
  }
} finally { await pool.end(); }
