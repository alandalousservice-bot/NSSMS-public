import { readFile } from 'node:fs/promises';
import pg from 'pg';

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error('DATABASE_URL is required');
const root = new URL('../../_incoming_geography_20260814/laravel-algereography-main/database/seeders/', import.meta.url);
const parse = (source) => [...source.matchAll(/\[\s*((?:.|\n)*?)\n\s*\],/g)].map(([, block]) => { const field = (key) => block.match(new RegExp(`'${key}'\\s*=>\\s*'?(\\d+|(?:\\\\'|[^'])*)'?`))?.[1] ?? null; return { id: Number(field('id')), name: field('name')?.replaceAll("\\'", "'"), arName: field('ar_name'), wilayaId: field('wilaya_id') ? Number(field('wilaya_id')) : null }; }).filter((row) => Number.isFinite(row.id) && row.name && row.arName);
const wilayas = parse(await readFile(new URL('WilayaSeeder.php', root), 'utf8'));
const dairas = parse(await readFile(new URL('DairaSeeder.php', root), 'utf8'));
const pool = new pg.Pool({ connectionString: databaseUrl });
try {
  for (const row of wilayas) await pool.query('INSERT INTO wilayas(id,name,ar_name) VALUES($1,$2,$3) ON CONFLICT(id) DO UPDATE SET name=EXCLUDED.name,ar_name=EXCLUDED.ar_name', [row.id,row.name,row.arName]);
  for (const row of dairas) { const wilayaId = row.wilayaId ? (row.wilayaId > 58 ? Number(String(row.wilayaId).slice(-2)) : row.wilayaId) : null; if (!wilayaId) continue; await pool.query('INSERT INTO dairas(id,wilaya_id,name,ar_name) VALUES($1,$2,$3,$4) ON CONFLICT(id) DO UPDATE SET wilaya_id=EXCLUDED.wilaya_id,name=EXCLUDED.name,ar_name=EXCLUDED.ar_name', [row.id,wilayaId,row.name,row.arName]); }
  console.log(`Imported ${wilayas.length} wilayas and ${dairas.length} dairas. Commune source not present in supplied archive.`);
} finally { await pool.end(); }
