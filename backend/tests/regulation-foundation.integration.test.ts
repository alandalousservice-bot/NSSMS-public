import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import pg from 'pg';

const enabled = Boolean(process.env.DATABASE_URL);
const suite = enabled ? describe : describe.skip;
const pool = enabled ? new pg.Pool({ connectionString: process.env.DATABASE_URL }) : null;

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
      await expect(client.query("INSERT INTO competition_programmes(season_id,code,title,effective_from) VALUES($1,'REG-TEST','Duplicate','2099-01-01')", [season.rows[0].id])).rejects.toThrow();
      const parent = await client.query("INSERT INTO regulation_versions(version_no,programme_id,effective_period) VALUES('1.0',$1,'[2099-01-01,2100-01-01)') RETURNING id", [programme.rows[0].id]);
      const child = await client.query("INSERT INTO regulation_versions(version_no,parent_id,programme_id,effective_period) VALUES('1.1',$1,$2,'[2100-01-01,2101-01-01)') RETURNING id", [parent.rows[0].id, programme.rows[0].id]);
      expect(child.rows[0].id).toBeTruthy();
      await expect(client.query("INSERT INTO regulation_rules(regulation_version_id,rule_key,value_type,value_text,value_numeric) VALUES($1,'bad','TEXT','x',1)", [parent.rows[0].id])).rejects.toThrow();
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
      await expect(client.query("INSERT INTO regulation_versions(version_no,programme_id,effective_period) VALUES('bad',$1,'[2098-02-01,2098-01-01)')", [programme.rows[0].id])).rejects.toThrow();
      await client.query("INSERT INTO regulation_versions(version_no,programme_id,effective_period,status) VALUES('active-1',$1,'[2098-01-01,2098-06-01)','ACTIVE')", [programme.rows[0].id]);
      await expect(client.query("INSERT INTO regulation_versions(version_no,programme_id,effective_period,status) VALUES('active-2',$1,'[2098-05-01,2098-07-01)','ACTIVE')", [programme.rows[0].id])).rejects.toThrow();
      await client.query('ROLLBACK');
    } finally { client.release(); }
  });

  it('keeps draft versions editable but protects approved versions and children', async () => {
    const client = await pool!.connect();
    try {
      await client.query('BEGIN');
      const season = await client.query("INSERT INTO seasons(name,start_date,end_date) VALUES('IMMUTABLE-TEST', '2097-01-01', '2097-12-31') RETURNING id");
      const programme = await client.query("INSERT INTO competition_programmes(season_id,code,title,effective_from) VALUES($1,'IMMUTABLE','Immutable','2097-01-01') RETURNING id", [season.rows[0].id]);
      const version = await client.query("INSERT INTO regulation_versions(version_no,programme_id,effective_period) VALUES('1.0',$1,'[2097-01-01,2098-01-01)') RETURNING id", [programme.rows[0].id]);
      await client.query("UPDATE regulation_versions SET source_summary='editable' WHERE id=$1", [version.rows[0].id]);
      await client.query("INSERT INTO regulation_rules(regulation_version_id,rule_key,value_type,value_text) VALUES($1,'label','TEXT','draft')", [version.rows[0].id]);
      await client.query("UPDATE regulation_versions SET status='APPROVED' WHERE id=$1", [version.rows[0].id]);
      await expect(client.query("UPDATE regulation_versions SET source_summary='tampered' WHERE id=$1", [version.rows[0].id])).rejects.toThrow(/immutable/);
      await expect(client.query("UPDATE regulation_rules SET value_text='tampered' WHERE regulation_version_id=$1", [version.rows[0].id])).rejects.toThrow(/immutable/);
      await expect(client.query("DELETE FROM regulation_versions WHERE id=$1", [version.rows[0].id])).rejects.toThrow(/immutable/);
      await client.query('ROLLBACK');
    } finally { client.release(); }
  });
});
