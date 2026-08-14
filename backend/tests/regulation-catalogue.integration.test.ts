import { afterAll, beforeAll, describe, expect, it } from 'vitest';
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

suite('regulation catalogue migration', () => {
  beforeAll(async () => { await pool!.query('SELECT 1'); });
  afterAll(async () => { await pool?.end(); });

  it('creates the regulation catalogue tables', async () => {
    const result = await pool!.query(
      "SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_name = ANY($1::text[])",
      [['sports', 'events', 'categories', 'event_rule_bindings', 'programme_regions', 'region_memberships']],
    );
    expect(result.rows.map((row) => row.table_name).sort()).toEqual([
      'categories', 'event_rule_bindings', 'events', 'programme_regions', 'region_memberships', 'sports',
    ]);
  });

  it('enforces sport, event, category, and binding identity', async () => {
    const client = await pool!.connect();
    try {
      await client.query('BEGIN');
      const season = await client.query("INSERT INTO seasons(name,start_date,end_date) VALUES('CATALOGUE-TEST', '2096-01-01', '2096-12-31') RETURNING id");
      const programme = await client.query("INSERT INTO competition_programmes(season_id,code,title,effective_from) VALUES($1,'CATALOGUE','Catalogue','2096-01-01') RETURNING id", [season.rows[0].id]);
      const version = await client.query("INSERT INTO regulation_versions(version_no,programme_id,effective_period) VALUES('1.0',$1,'[2096-01-01,2097-01-01)') RETURNING id", [programme.rows[0].id]);
      const athletics = await client.query("INSERT INTO sports(code,name,sport_type) VALUES('ATH','Athletics','INDIVIDUAL') RETURNING id");
      await expectDatabaseFailure(client, () => client.query("INSERT INTO sports(code,name,sport_type) VALUES('ATH','Duplicate','INDIVIDUAL')"));
      const swimming = await client.query("INSERT INTO sports(code,name,sport_type) VALUES('SWI','Swimming','INDIVIDUAL') RETURNING id");
      const event = await client.query("INSERT INTO events(sport_id,code,name,format,measurement_type) VALUES($1,'100M','100 metres','INDIVIDUAL','TIME') RETURNING id", [athletics.rows[0].id]);
      await expectDatabaseFailure(client, () => client.query("INSERT INTO events(sport_id,code,name,format) VALUES($1,'100M','Duplicate','INDIVIDUAL')", [athletics.rows[0].id]));
      await client.query("INSERT INTO events(sport_id,code,name,format,measurement_type) VALUES($1,'100M','100 metres freestyle','INDIVIDUAL','TIME')", [swimming.rows[0].id]);
      const category = await client.query("INSERT INTO categories(programme_id,code,name,gender_code,education_level,regulation_version_id) VALUES($1,'U15-M','Under 15 boys','MALE','MIDDLE',$2) RETURNING id", [programme.rows[0].id, version.rows[0].id]);
      await expectDatabaseFailure(client, () => client.query("INSERT INTO categories(programme_id,code,name,gender_code,regulation_version_id) VALUES($1,'U15-M','Duplicate','MALE',$2)", [programme.rows[0].id, version.rows[0].id]));
      await client.query("INSERT INTO categories(code,name,gender_code,regulation_version_id) VALUES('OPEN','Open','OPEN',$1)", [version.rows[0].id]);
      await expectDatabaseFailure(client, () => client.query("INSERT INTO categories(code,name,gender_code,regulation_version_id) VALUES('OPEN','Duplicate global','OPEN',$1)", [version.rows[0].id]));
      await client.query("INSERT INTO event_rule_bindings(event_id,category_id,stage_level_code,regulation_version_id,precedence,effective_period) VALUES($1,$2,'WILAYA',$3,10,'[2096-01-01,2096-07-01)')", [event.rows[0].id, category.rows[0].id, version.rows[0].id]);
      await expectDatabaseFailure(client, () => client.query("INSERT INTO event_rule_bindings(event_id,category_id,stage_level_code,regulation_version_id,precedence,effective_period) VALUES($1,$2,'WILAYA',$3,10,'[2096-06-01,2096-12-01)')", [event.rows[0].id, category.rows[0].id, version.rows[0].id]));
      await client.query("INSERT INTO event_rule_bindings(event_id,category_id,stage_level_code,regulation_version_id,precedence,effective_period) VALUES($1,$2,'WILAYA',$3,10,'[2096-07-01,2097-01-01)')", [event.rows[0].id, category.rows[0].id, version.rows[0].id]);
      const derivedVersion = await client.query("INSERT INTO regulation_versions(version_no,programme_id,effective_period) VALUES('2.0',$1,'[2096-01-01,2097-01-01)') RETURNING id", [programme.rows[0].id]);
      const derivedCategory = await client.query("INSERT INTO categories(programme_id,code,name,gender_code,education_level,regulation_version_id) VALUES($1,'U15-M','Under 15 boys','MALE','MIDDLE',$2) RETURNING id", [programme.rows[0].id, derivedVersion.rows[0].id]);
      await client.query("INSERT INTO event_rule_bindings(event_id,category_id,stage_level_code,regulation_version_id,precedence,effective_period) VALUES($1,$2,'WILAYA',$3,10,'[2096-01-01,2096-07-01)')", [event.rows[0].id, derivedCategory.rows[0].id, derivedVersion.rows[0].id]);
      await client.query('SELECT 1');
      await client.query('ROLLBACK');
    } finally { client.release(); }
  });

  it('enforces programme-region membership and published regulation immutability', async () => {
    const client = await pool!.connect();
    try {
      await client.query('BEGIN');
      const season = await client.query("INSERT INTO seasons(name,start_date,end_date) VALUES('REGION-TEST', '2095-01-01', '2095-12-31') RETURNING id");
      const programme = await client.query("INSERT INTO competition_programmes(season_id,code,title,effective_from) VALUES($1,'REGION','Regions','2095-01-01') RETURNING id", [season.rows[0].id]);
      const version = await client.query("INSERT INTO regulation_versions(version_no,programme_id,effective_period) VALUES('1.0',$1,'[2095-01-01,2096-01-01)') RETURNING id", [programme.rows[0].id]);
      const wilaya = await client.query("INSERT INTO wilayas(id,name,ar_name) VALUES(58,'Test Wilaya','ولاية تجريبية') ON CONFLICT (id) DO UPDATE SET name=EXCLUDED.name RETURNING id");
      const regionA = await client.query("INSERT INTO programme_regions(programme_id,regulation_version_id,code,name,effective_period) VALUES($1,$2,'R1','Region One','[2095-01-01,2096-01-01)') RETURNING id", [programme.rows[0].id, version.rows[0].id]);
      await expectDatabaseFailure(client, () => client.query("INSERT INTO programme_regions(programme_id,regulation_version_id,code,name,effective_period) VALUES($1,$2,'R1','Duplicate','[2095-01-01,2096-01-01)')", [programme.rows[0].id, version.rows[0].id]));
      const regionB = await client.query("INSERT INTO programme_regions(programme_id,regulation_version_id,code,name,effective_period) VALUES($1,$2,'R2','Region Two','[2095-01-01,2096-01-01)') RETURNING id", [programme.rows[0].id, version.rows[0].id]);
      await client.query("INSERT INTO region_memberships(programme_region_id,wilaya_id,regulation_version_id,effective_period) VALUES($1,$2,$3,'[2095-01-01,2095-06-01)')", [regionA.rows[0].id, wilaya.rows[0].id, version.rows[0].id]);
      await expectDatabaseFailure(client, () => client.query("INSERT INTO region_memberships(programme_region_id,wilaya_id,regulation_version_id,effective_period) VALUES($1,$2,$3,'[2095-05-01,2095-12-01)')", [regionB.rows[0].id, wilaya.rows[0].id, version.rows[0].id]), /overlapping/);
      await client.query("INSERT INTO region_memberships(programme_region_id,wilaya_id,regulation_version_id,effective_period) VALUES($1,$2,$3,'[2095-06-01,2096-01-01)')", [regionB.rows[0].id, wilaya.rows[0].id, version.rows[0].id]);
      await expectDatabaseFailure(client, () => client.query("INSERT INTO region_memberships(programme_region_id,wilaya_id,regulation_version_id,effective_period) VALUES($1,59,$2,'[2095-01-01,2096-01-01)')", [regionA.rows[0].id, version.rows[0].id]));
      await client.query("UPDATE regulation_versions SET status='APPROVED' WHERE id=$1", [version.rows[0].id]);
      await expectDatabaseFailure(client, () => client.query("UPDATE programme_regions SET name='Tampered' WHERE id=$1", [regionA.rows[0].id]), /immutable/);
      await expectDatabaseFailure(client, () => client.query("INSERT INTO programme_regions(programme_id,regulation_version_id,code,name,effective_period) VALUES($1,$2,'LATE','Late','[2095-01-01,2096-01-01)')", [programme.rows[0].id, version.rows[0].id]), /immutable/);
      await client.query('ROLLBACK');
    } finally { client.release(); }
  });
});
