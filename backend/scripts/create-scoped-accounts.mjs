import { randomBytes, scryptSync } from 'node:crypto';
import pg from 'pg';

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error('DATABASE_URL is required');
const required = ['ASSOCIATION_ADMIN_PASSWORD','ASSOCIATION_REP_PASSWORD','INSTITUTION_USER_PASSWORD'];
if (required.some((key) => !process.env[key] || process.env[key].length < 12)) throw new Error('Set scoped account passwords (minimum 12 characters)');
const pool = new pg.Pool({ connectionString: databaseUrl });
const encode = (password) => { const salt = randomBytes(16).toString('hex'); return `scrypt$${salt}$${scryptSync(password, salt, 64).toString('hex')}`; };
try {
  const wilayaId = Number(process.env.WILAYA_ID ?? 16); const dairaId = Number(process.env.DAIRA_ID ?? 0);
  const association = await pool.query(`INSERT INTO organizations(name,code,organization_type,wilaya_id) VALUES($1,$2,'ASSOCIATION',$3) ON CONFLICT(code) DO UPDATE SET name=EXCLUDED.name,organization_type='ASSOCIATION',wilaya_id=EXCLUDED.wilaya_id RETURNING id`, [process.env.ASSOCIATION_NAME ?? 'الرابطة الرياضية التجريبية', process.env.ASSOCIATION_CODE ?? 'DEMO-ASSOCIATION', wilayaId]);
  const institution = await pool.query(`INSERT INTO educational_institutions(organization_id,name,code,daira_id) VALUES($1,$2,$3,$4) ON CONFLICT(organization_id,code) DO UPDATE SET name=EXCLUDED.name,daira_id=EXCLUDED.daira_id RETURNING id`, [association.rows[0].id, process.env.INSTITUTION_NAME ?? 'المؤسسة المنخرطة التجريبية', process.env.INSTITUTION_CODE ?? 'DEMO-MEMBER-INSTITUTION', dairaId]);
  const accounts = [
    ['demo.association.admin', 'Association Administrator', process.env.ASSOCIATION_ADMIN_PASSWORD, 'ASSOCIATION_ADMINISTRATOR', association.rows[0].id, null],
    ['demo.association.rep', 'Association Representative', process.env.ASSOCIATION_REP_PASSWORD, 'ASSOCIATION_REPRESENTATIVE', association.rows[0].id, null],
    ['demo.institution', 'Member Institution User', process.env.INSTITUTION_USER_PASSWORD, 'MEMBER_INSTITUTION_USER', association.rows[0].id, institution.rows[0].id, null],
    ['demo.daira.officer', 'Daira Officer', process.env.DAIRA_OFFICER_PASSWORD ?? process.env.ASSOCIATION_REP_PASSWORD, 'DAIRA_OFFICER', association.rows[0].id, null, dairaId]
  ];
  for (const [username, displayName, password, role, organizationId, institutionId, scopedDairaId] of accounts) {
    const user = await pool.query(`INSERT INTO users(username,display_name,password_hash,organization_id,institution_id,daira_id) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(username) DO UPDATE SET display_name=EXCLUDED.display_name,password_hash=EXCLUDED.password_hash,organization_id=EXCLUDED.organization_id,institution_id=EXCLUDED.institution_id,daira_id=EXCLUDED.daira_id,status='ACTIVE' RETURNING id`, [username, displayName, encode(password), organizationId, institutionId, scopedDairaId]);
    await pool.query(`INSERT INTO user_roles(user_id,role_id) SELECT $1,id FROM roles WHERE name=$2 ON CONFLICT DO NOTHING`, [user.rows[0].id, role]);
    console.log(`Created/updated ${username}`);
  }
} finally { await pool.end(); }
