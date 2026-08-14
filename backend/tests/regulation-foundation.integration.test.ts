import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import pg from 'pg';

const enabled = Boolean(process.env.DATABASE_URL);
const suite = enabled ? describe : describe.skip;
const pool = enabled ? new pg.Pool({ connectionString: process.env.DATABASE_URL }) : null;

async function expectDatabaseFailure(
  client: pg.PoolClient,
  statement: () => Promise<unknown>,
  message?: RegExp,
): Promise<void> {
  await client.query('SAVEPOINT expected_database_failure');
  try {
    await statement();
  } catch (error) {
    await client.query('ROLLBACK TO SAVEPOINT expected_database_failure');
    await client.query('RELEASE SAVEPOINT expected_database_failure');
    if (message) expect(String((error as Error).message)).toMatch(message);
    return;
  }

  await client.query('ROLLBACK TO SAVEPOINT expected_database_failure');
  await client.query('RELEASE SAVEPOINT expected_database_failure');
  throw new Error('Expected database statement to fail');
}

suite('regulation foundation migration', () => {
  beforeAll(async () => { await pool!.query('SELECT 1'); });
  afterAll(async () => { await pool?.end(); });

  it('creates the additive foundation tables', async () => {
    const result = await pool!.query(
      "SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_name = ANY($1::text[])",
      [['competition_programmes', 'regulation_versions', 'regulation_rules', 'regulation_sources']],
    );
    expect(result.rows.map((row) => row.table_name).sort()).toEqual([
      'competition_programmes', 'regulation_rules', 'regulation_sources', 'regulation_versions',
    ]);
  });

  it('enforces programme identity, parent versions, typed rules, and sources', async () => {
    const client = await pool!.connect();
    try {
      await client.query('BEGIN');
      const season = await client.query("INSERT INTO seasons(name,start_date,end_date) VALUES('REG-TEST', '2099-01-01', '2099-12-31') RETURNING id");
      const programme = await client.query("INSERT INTO competition_programmes(season_id,code,title,effective_from) VALUES($1,'REG-TEST','Regulation Test','2099-01-01') RETURNING id", [season.rows[0].id]);
      await expectDatabaseFailure(client, () => client.query("INSERT INTO competition_programmes(season_id,code,title,effective_from) VALUES($1,'REG-TEST','Duplicate','2099-01-01')", [season.rows[0].id]));
      await client.query('SELECT 1');
      const parent = await client.query("INSERT INTO regulation_versions(version_no,programme_id,effective_period) VALUES('1.0',$1,'[2099-01-01,2100-01-01)') RETURNING id", [programme.rows[0].id]);
      const child = await client.query("INSERT INTO regulation_versions(version_no,parent_id,programme_id,effective_period) VALUES('1.1',$1,$2,'[2100-01-01,2101-01-01)') RETURNING id", [parent.rows[0].id, programme.rows[0].id]);
      expect(child.rows[0].id).toBeTruthy();
      await expectDatabaseFailure(client, () => client.query("INSERT INTO regulation_rules(regulation_version_id,rule_key,value_type,value_text,value_numeric) VALUES($1,'bad','TEXT','x',1)", [parent.rows[0].id]));
      await client.query("INSERT INTO regulation_rules(regulation_version_id,rule_key,value_type,value_numeric,unit) VALUES($1,'team_size','NUMERIC',12,'players')", [parent.rows[0].id]);
      await client.query("INSERT INTO regulation_sources(regulation_version_id,title,issuer,page_section) VALUES($1,'Test Circular','Test Authority','p. 1')", [parent.rows[0].id]);
      await client.query('ROLLBACK');
    } finally { client.release(); }
  });

  it('rejects invalid dates and overlapping active versions', async () => {
    const client = await pool!.connect();
    try {
      await client.query('BEGIN');
      const season = await client.query("INSERT INTO seasons(name,start_date,end_date) VALUES('OVERLAP-TEST', '2098-01-01', '2098-12-31') RETURNING id");
      const programme = await client.query("INSERT INTO competition_programmes(season_id,code,title,effective_from) VALUES($1,'OVERLAP','Overlap','2098-01-01') RETURNING id", [season.rows[0].id]);
      await expectDatabaseFailure(client, () => client.query("INSERT INTO regulation_versions(version_no,programme_id,effective_period) VALUES('bad',$1,'[2098-02-01,2098-01-01)')", [programme.rows[0].id]));
      await client.query('SELECT 1');
      await client.query("INSERT INTO regulation_versions(version_no,programme_id,effective_period,status) VALUES('active-1',$1,'[2098-01-01,2098-06-01)','ACTIVE')", [programme.rows[0].id]);
      await expectDatabaseFailure(client, () => client.query("INSERT INTO regulation_versions(version_no,programme_id,effective_period,status) VALUES('active-2',$1,'[2098-05-01,2098-07-01)','ACTIVE')", [programme.rows[0].id]));
      await client.query('SELECT 1');
      await client.query('ROLLBACK');
    } finally { client.release(); }
  });

  it('allows all draft child mutations and blocks every approved child mutation', async () => {
    const client = await pool!.connect();
    try {
      await client.query('BEGIN');
      const season = await client.query("INSERT INTO seasons(name,start_date,end_date) VALUES('IMMUTABLE-TEST', '2097-01-01', '2097-12-31') RETURNING id");
      const programme = await client.query("INSERT INTO competition_programmes(season_id,code,title,effective_from) VALUES($1,'IMMUTABLE','Immutable','2097-01-01') RETURNING id", [season.rows[0].id]);
      const version = await client.query("INSERT INTO regulation_versions(version_no,programme_id,effective_period) VALUES('1.0',$1,'[2097-01-01,2098-01-01)') RETURNING id", [programme.rows[0].id]);
      await client.query("UPDATE regulation_versions SET source_summary='editable' WHERE id=$1", [version.rows[0].id]);
      const draftRule = await client.query("INSERT INTO regulation_rules(regulation_version_id,rule_key,value_type,value_text) VALUES($1,'label','TEXT','draft') RETURNING id", [version.rows[0].id]);
      await client.query("UPDATE regulation_rules SET value_text='draft-updated' WHERE id=$1", [draftRule.rows[0].id]);
      await client.query("DELETE FROM regulation_rules WHERE id=$1", [draftRule.rows[0].id]);
      const draftSource = await client.query("INSERT INTO regulation_sources(regulation_version_id,title,issuer) VALUES($1,'Draft Source','Test') RETURNING id", [version.rows[0].id]);
      await client.query("UPDATE regulation_sources SET title='Draft Source Updated' WHERE id=$1", [draftSource.rows[0].id]);
      await client.query("DELETE FROM regulation_sources WHERE id=$1", [draftSource.rows[0].id]);
      const approvedRule = await client.query("INSERT INTO regulation_rules(regulation_version_id,rule_key,value_type,value_text) VALUES($1,'approved_rule','TEXT','fixed') RETURNING id", [version.rows[0].id]);
      const approvedSource = await client.query("INSERT INTO regulation_sources(regulation_version_id,title,issuer) VALUES($1,'Approved Source','Test') RETURNING id", [version.rows[0].id]);
      await client.query("UPDATE regulation_versions SET status='APPROVED' WHERE id=$1", [version.rows[0].id]);
      await expectDatabaseFailure(client, () => client.query("UPDATE regulation_versions SET source_summary='tampered' WHERE id=$1", [version.rows[0].id]), /immutable/);
      await expectDatabaseFailure(client, () => client.query("INSERT INTO regulation_rules(regulation_version_id,rule_key,value_type,value_text) VALUES($1,'late_rule','TEXT','blocked')", [version.rows[0].id]), /immutable/);
      await expectDatabaseFailure(client, () => client.query("UPDATE regulation_rules SET value_text='tampered' WHERE id=$1", [approvedRule.rows[0].id]), /immutable/);
      await expectDatabaseFailure(client, () => client.query("DELETE FROM regulation_rules WHERE id=$1", [approvedRule.rows[0].id]), /immutable/);
      await expectDatabaseFailure(client, () => client.query("INSERT INTO regulation_sources(regulation_version_id,title,issuer) VALUES($1,'Late Source','Test')", [version.rows[0].id]), /immutable/);
      await expectDatabaseFailure(client, () => client.query("UPDATE regulation_sources SET title='tampered' WHERE id=$1", [approvedSource.rows[0].id]), /immutable/);
      await expectDatabaseFailure(client, () => client.query("DELETE FROM regulation_sources WHERE id=$1", [approvedSource.rows[0].id]), /immutable/);
      await expectDatabaseFailure(client, () => client.query("DELETE FROM regulation_versions WHERE id=$1", [version.rows[0].id]), /immutable/);

      for (const status of ['ACTIVE', 'RETIRED']) {
        const future = await client.query("INSERT INTO regulation_versions(version_no,programme_id,effective_period,status) VALUES($1,$2,$3,$4) RETURNING id", [`${status}-1.0`, programme.rows[0].id, status === 'ACTIVE' ? '[2097-01-01,2097-06-01)' : '[2097-06-01,2098-01-01)', status]);
        await expectDatabaseFailure(client, () => client.query("INSERT INTO regulation_rules(regulation_version_id,rule_key,value_type,value_text) VALUES($1,$2,'TEXT','blocked')", [future.rows[0].id, `${status}_late`]), /immutable/);
      }
      await client.query('ROLLBACK');
    } finally { client.release(); }
  });
});
