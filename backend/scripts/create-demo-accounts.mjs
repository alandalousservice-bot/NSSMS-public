import { randomBytes, scryptSync } from 'node:crypto';
import pg from 'pg';

const { Pool } = pg;
const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error('DATABASE_URL is required');
const accounts = [
  { username: process.env.DEMO_ADMIN_USERNAME ?? 'demo.admin', displayName: 'Demo System Administrator', role: 'SYSTEM_ADMINISTRATOR', password: process.env.DEMO_ADMIN_PASSWORD },
  { username: process.env.DEMO_NATIONAL_USERNAME ?? 'demo.national', displayName: 'Demo National Administrator', role: 'NATIONAL_ADMINISTRATOR', password: process.env.DEMO_NATIONAL_PASSWORD }
];
if (accounts.some((account) => !account.password || account.password.length < 12)) throw new Error('Set DEMO_ADMIN_PASSWORD and DEMO_NATIONAL_PASSWORD (minimum 12 characters)');
const pool = new Pool({ connectionString: databaseUrl });
try {
  for (const account of accounts) {
    const salt = randomBytes(16).toString('hex');
    const hash = scryptSync(account.password, salt, 64).toString('hex');
    const result = await pool.query(`INSERT INTO users (username, display_name, password_hash) VALUES ($1,$2,$3) ON CONFLICT (username) DO UPDATE SET display_name=EXCLUDED.display_name, password_hash=EXCLUDED.password_hash, status='ACTIVE' RETURNING id`, [account.username, account.displayName, `scrypt$${salt}$${hash}`]);
    await pool.query(`INSERT INTO user_roles (user_id, role_id) SELECT $1, id FROM roles WHERE name=$2 ON CONFLICT DO NOTHING`, [result.rows[0].id, account.role]);
    console.log(`Created/updated ${account.username}`);
  }
} finally { await pool.end(); }
