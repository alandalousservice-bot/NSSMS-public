import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import pg from 'pg';

const enabled = Boolean(process.env.DATABASE_URL);
const suite = enabled ? describe : describe.skip;
const pool = enabled ? new pg.Pool({ connectionString: process.env.DATABASE_URL }) : null;

suite('PostgreSQL integration', () => {
  beforeAll(async () => { await pool!.query('SELECT 1'); });
  afterAll(async () => { await pool?.end(); });
  it('contains the governed core tables', async () => {
    const result = await pool!.query("SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_name = ANY($1::text[])", [['users','roles','permissions','organizations','educational_institutions','participants','seasons','competitions','sports_licenses','qr_verifications','results','audit_logs']]);
    expect(result.rows.map((row) => row.table_name).sort()).toEqual(['audit_logs','competitions','educational_institutions','organizations','participants','permissions','qr_verifications','results','roles','seasons','sports_licenses','users']);
  });
  it('keeps audit logs append-only', async () => {
    await expect(pool!.query("UPDATE audit_logs SET action='TAMPER' WHERE false")).resolves.toBeTruthy();
    await expect(pool!.query("INSERT INTO audit_logs(action,entity_type,result_status) VALUES('INTEGRATION_TEST','TEST','SUCCESS') RETURNING id")).resolves.toBeTruthy();
    const row = await pool!.query("SELECT id FROM audit_logs WHERE action='INTEGRATION_TEST' ORDER BY occurred_at DESC LIMIT 1");
    await expect(pool!.query('DELETE FROM audit_logs WHERE id=$1',[row.rows[0].id])).rejects.toThrow(/append-only/);
  });
});
