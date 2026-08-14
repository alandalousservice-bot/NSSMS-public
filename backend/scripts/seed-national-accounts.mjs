import { randomBytes, scryptSync } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import pg from 'pg';

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error('DATABASE_URL is required');
const pool = new pg.Pool({ connectionString: databaseUrl });
const hash = (password) => { const salt = randomBytes(16).toString('hex'); return `scrypt$${salt}$${scryptSync(password, salt, 64).toString('hex')}`; };
const clean = (value) => String(value).replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-|-$/g, '').toLowerCase();
const credentials = [];
async function account(username, displayName, password, role, organizationId, institutionId = null, dairaId = null) {
  const user = await pool.query(`INSERT INTO users(username,display_name,password_hash,organization_id,institution_id,daira_id) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(username) DO UPDATE SET display_name=EXCLUDED.display_name,password_hash=EXCLUDED.password_hash,organization_id=EXCLUDED.organization_id,institution_id=EXCLUDED.institution_id,daira_id=EXCLUDED.daira_id,status='ACTIVE' RETURNING id`, [username, displayName, hash(password), organizationId, institutionId, dairaId]);
  await pool.query(`INSERT INTO user_roles(user_id,role_id) SELECT $1,id FROM roles WHERE name=$2 ON CONFLICT DO NOTHING`, [user.rows[0].id, role]);
  credentials.push({ username, password, role, scope: dairaId !== null ? `daira:${dairaId}` : institutionId !== null ? `institution:${institutionId}` : `organization:${organizationId}` });
}
try {
  const wilayas = (await pool.query('SELECT id,name FROM wilayas ORDER BY id')).rows;
  const dairas = (await pool.query('SELECT id,wilaya_id,name FROM dairas ORDER BY id')).rows;
  for (const wilaya of wilayas) {
    const code = `WILAYA-${String(wilaya.id).padStart(2, '0')}`;
    const org = await pool.query(`INSERT INTO organizations(name,code,organization_type,wilaya_id) VALUES($1,$2,'ASSOCIATION',$3) ON CONFLICT(code) DO UPDATE SET name=EXCLUDED.name,organization_type='ASSOCIATION',wilaya_id=EXCLUDED.wilaya_id RETURNING id`, [`الرابطة الولائية ${wilaya.name}`, code, wilaya.id]);
    const organizationId = org.rows[0].id;
    await account(`assoc.w${String(wilaya.id).padStart(2, '0')}.admin`, `مدير الرابطة ${wilaya.name}`, `NssmsAssoc-W${String(wilaya.id).padStart(2, '0')}-2026!`, 'ASSOCIATION_ADMINISTRATOR', organizationId);
    for (const daira of dairas.filter((item) => item.wilaya_id === wilaya.id)) {
      await account(`daira.${String(daira.id).padStart(3, '0')}.admin`, `مشرف دائرة ${daira.name}`, `NssmsDaira-${String(daira.id).padStart(3, '0')}-2026!`, 'DAIRA_OFFICER', organizationId, null, daira.id);
      const institutionCode = `PLACEHOLDER-${String(daira.id).padStart(3, '0')}`;
      const institution = await pool.query(`INSERT INTO educational_institutions(organization_id,daira_id,name,code) VALUES($1,$2,$3,$4) ON CONFLICT(organization_id,code) DO UPDATE SET name=EXCLUDED.name,daira_id=EXCLUDED.daira_id RETURNING id`, [organizationId, daira.id, `مؤسسة منخرطة مؤقتة - ${daira.name}`, institutionCode]);
      await account(`institution.${String(daira.id).padStart(3, '0')}.demo`, `حساب المؤسسة المؤقتة ${daira.name}`, `NssmsInst-${String(daira.id).padStart(3, '0')}-2026!`, 'MEMBER_INSTITUTION_USER', organizationId, institution.rows[0].id);
    }
  }
  await writeFile(new URL('../var-demo-accounts.csv', import.meta.url), `username,password,role,scope\n${credentials.map((row) => `${row.username},${row.password},${row.role},${row.scope}`).join('\n')}\n`, 'utf8');
  console.log(`Created/updated ${credentials.length} national scoped demo accounts (${wilayas.length} wilaya administrators, ${dairas.length} daira officers, ${dairas.length} placeholder institution accounts).`);
} finally { await pool.end(); }
