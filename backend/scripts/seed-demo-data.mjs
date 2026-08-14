import pg from 'pg';
const { Pool } = pg;
if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required');
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
try {
  const org = await pool.query(`INSERT INTO organizations(name,code) VALUES ('وزارة التربية الوطنية - تجريبي','DEMO-MEN') ON CONFLICT(code) DO UPDATE SET name=EXCLUDED.name RETURNING id`);
  const institution = await pool.query(`INSERT INTO educational_institutions(organization_id,name,code) VALUES($1,'ثانوية الرياضة الوطنية','DEMO-SCHOOL') ON CONFLICT(organization_id,code) DO UPDATE SET name=EXCLUDED.name RETURNING id`, [org.rows[0].id]);
  await pool.query(`INSERT INTO participants(institution_id,given_name,family_name,status) SELECT $1,'أمين','تجريبي','ACTIVE' WHERE NOT EXISTS (SELECT 1 FROM participants WHERE institution_id=$1 AND given_name='أمين' AND family_name='تجريبي')`, [institution.rows[0].id]);
  await pool.query(`INSERT INTO seasons(name,start_date,end_date,status) VALUES('الموسم التجريبي 2025-2026','2025-09-01','2026-06-30','ACTIVE') ON CONFLICT DO NOTHING`);
  console.log(`Demo data ready. institutionId=${institution.rows[0].id}`);
} finally { await pool.end(); }
