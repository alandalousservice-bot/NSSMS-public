import { randomBytes, scryptSync } from 'node:crypto';
import pg from 'pg';

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error('DATABASE_URL is required for integration tests');

const pool = new pg.Pool({ connectionString: databaseUrl });
const passwordHash = (password) => {
  const salt = randomBytes(16).toString('hex');
  return `scrypt$${salt}$${scryptSync(password, salt, 64).toString('hex')}`;
};

async function account({ username, displayName, password, role, organizationId = null, institutionId = null, dairaId = null }) {
  const user = await pool.query(
    `INSERT INTO users(username, display_name, password_hash, organization_id, institution_id, daira_id)
     VALUES($1,$2,$3,$4,$5,$6)
     ON CONFLICT(username) DO UPDATE SET
       display_name=EXCLUDED.display_name,
       password_hash=EXCLUDED.password_hash,
       organization_id=EXCLUDED.organization_id,
       institution_id=EXCLUDED.institution_id,
       daira_id=EXCLUDED.daira_id,
       status='ACTIVE'
     RETURNING id`,
    [username, displayName, passwordHash(password), organizationId, institutionId, dairaId]
  );
  await pool.query(
    `INSERT INTO user_roles(user_id, role_id)
     SELECT $1, id FROM roles WHERE name=$2
     ON CONFLICT DO NOTHING`,
    [user.rows[0].id, role]
  );
}

try {
  // These are deliberately marked fixture data and are the minimum geography
  // needed by the scope tests. They are not production/reference data.
  await pool.query(
    `INSERT INTO wilayas(id, name, ar_name) VALUES
      (1, 'TEST FIXTURE WILAYA 01', 'ولاية اختبار 01'),
      (2, 'TEST FIXTURE WILAYA 02', 'ولاية اختبار 02')
     ON CONFLICT(id) DO NOTHING`
  );
  await pool.query(
    `INSERT INTO dairas(id, wilaya_id, name, ar_name) VALUES
      (1, 1, 'TEST FIXTURE DAIRA 001', 'دائرة اختبار 001'),
      (2, 2, 'TEST FIXTURE DAIRA 002', 'دائرة اختبار 002')
     ON CONFLICT(id) DO NOTHING`
  );

  const organizations = {};
  for (const [code, wilayaId] of [['WILAYA-01', 1], ['WILAYA-02', 2]]) {
    const result = await pool.query(
      `INSERT INTO organizations(name, code, organization_type, wilaya_id)
       VALUES($1,$2,'ASSOCIATION',$3)
       ON CONFLICT(code) DO UPDATE SET
         name=EXCLUDED.name, organization_type='ASSOCIATION', wilaya_id=EXCLUDED.wilaya_id,
         status='ACTIVE', archived_at=NULL
       RETURNING id`,
      [`TEST FIXTURE ${code}`, code, wilayaId]
    );
    organizations[code] = result.rows[0].id;
  }

  const institutions = {};
  for (const [key, organizationCode, dairaId] of [['001', 'WILAYA-01', 1], ['002', 'WILAYA-02', 2]]) {
    const result = await pool.query(
      `INSERT INTO educational_institutions(organization_id, name, code, daira_id)
       VALUES($1,$2,$3,$4)
       ON CONFLICT(organization_id, code) DO UPDATE SET
         name=EXCLUDED.name, daira_id=EXCLUDED.daira_id, status='ACTIVE', archived_at=NULL
       RETURNING id`,
      [organizations[organizationCode], `TEST FIXTURE INSTITUTION ${key}`, `TEST-FIXTURE-${key}`, dairaId]
    );
    institutions[key] = result.rows[0].id;
  }

  await account({ username: 'demo.admin', displayName: 'Test Fixture National Admin', password: 'NssmsDemoAdmin-2026!', role: 'SYSTEM_ADMINISTRATOR' });
  await account({ username: 'assoc.w01.admin', displayName: 'Test Fixture Association W01', password: 'NssmsAssoc-W01-2026!', role: 'ASSOCIATION_ADMINISTRATOR', organizationId: organizations['WILAYA-01'] });
  await account({ username: 'assoc.w02.admin', displayName: 'Test Fixture Association W02', password: 'NssmsAssoc-W02-2026!', role: 'ASSOCIATION_ADMINISTRATOR', organizationId: organizations['WILAYA-02'] });
  await account({ username: 'daira.001.admin', displayName: 'Test Fixture Daira 001', password: 'NssmsDaira-001-2026!', role: 'DAIRA_OFFICER', organizationId: organizations['WILAYA-01'], dairaId: 1 });
  await account({ username: 'institution.001.demo', displayName: 'Test Fixture Institution 001', password: 'NssmsInst-001-2026!', role: 'MEMBER_INSTITUTION_USER', organizationId: organizations['WILAYA-01'], institutionId: institutions['001'] });
  console.log('Prepared deterministic integration-test fixture: 2 organizations, 2 institutions, 5 accounts');
} finally {
  await pool.end();
}
