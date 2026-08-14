import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import pg from 'pg';

const enabled = Boolean(process.env.DATABASE_URL);
const suite = enabled ? describe : describe.skip;
const pool = enabled ? new pg.Pool({ connectionString: process.env.DATABASE_URL }) : null;

async function expectDatabaseFailure(client: pg.PoolClient, statement: () => Promise<unknown>, message?: RegExp): Promise<void> {
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

suite('competition operational foundation migration', () => {
  beforeAll(async () => { await pool!.query('SELECT 1'); });
  afterAll(async () => { await pool?.end(); });

  it('creates the additive operational tables', async () => {
    const result = await pool!.query(
      "SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_name = ANY($1::text[])",
      [['competition_stages', 'calendar_occurrences', 'venues', 'occurrence_venues']],
    );
    expect(result.rows.map((row) => row.table_name).sort()).toEqual([
      'calendar_occurrences', 'competition_stages', 'occurrence_venues', 'venues',
    ]);
  });

  it('enforces stage hierarchy, programme context, regions, and geography', async () => {
    const client = await pool!.connect();
    try {
      await client.query('BEGIN');
      await client.query("INSERT INTO wilayas(id,name,ar_name) VALUES(57,'Test Wilaya 57','ولاية 57'),(58,'Test Wilaya 58','ولاية 58') ON CONFLICT (id) DO NOTHING");
      await client.query("INSERT INTO dairas(id,wilaya_id,name,ar_name) VALUES(999001,58,'Test Daira 58','دائرة 58'),(999002,57,'Test Daira 57','دائرة 57'),(999003,58,'Other Test Daira 58','دائرة أخرى 58') ON CONFLICT (id) DO NOTHING");
      await client.query("INSERT INTO communes(id,daira_id,wilaya_id,name,ar_name) VALUES(999001,999001,58,'Test Commune 58','بلدية 58') ON CONFLICT (id) DO NOTHING");
      const season = await client.query("INSERT INTO seasons(name,start_date,end_date) VALUES('STAGE-TEST','2094-01-01','2094-12-31') RETURNING id");
      const programme = await client.query("INSERT INTO competition_programmes(season_id,code,title,effective_from) VALUES($1,'STAGE','Stages','2094-01-01') RETURNING id", [season.rows[0].id]);
      const version = await client.query("INSERT INTO regulation_versions(version_no,programme_id,effective_period) VALUES('1.0',$1,'[2094-01-01,2095-01-01)') RETURNING id", [programme.rows[0].id]);
      const region = await client.query("INSERT INTO programme_regions(programme_id,regulation_version_id,code,name,effective_period) VALUES($1,$2,'R1','Region One','[2094-01-01,2095-01-01)') RETURNING id", [programme.rows[0].id, version.rows[0].id]);
      const competition = await client.query("INSERT INTO competitions(season_id,name) VALUES($1,'Stage Competition') RETURNING id", [season.rows[0].id]);
      const secondCompetition = await client.query("INSERT INTO competitions(season_id,name) VALUES($1,'Other Competition') RETURNING id", [season.rows[0].id]);
      const root = await client.query("INSERT INTO competition_stages(competition_id,programme_id,programme_region_id,regulation_version_id,stage_level_code,host_wilaya_id,host_daira_id,host_commune_id,start_date,end_date) VALUES($1,$2,$3,$4,'WILAYA',58,999001,999001,'2094-02-01','2094-02-03') RETURNING id", [competition.rows[0].id, programme.rows[0].id, region.rows[0].id, version.rows[0].id]);
      await client.query("INSERT INTO competition_stages(competition_id,parent_stage_id,programme_id,regulation_version_id,stage_level_code) VALUES($1,$2,$3,$4,'DAIRA')", [competition.rows[0].id, root.rows[0].id, programme.rows[0].id, version.rows[0].id]);
      const derivedVersion = await client.query("INSERT INTO regulation_versions(version_no,programme_id,effective_period) VALUES('2.0',$1,'[2094-01-01,2095-01-01)') RETURNING id", [programme.rows[0].id]);
      await expectDatabaseFailure(client, () => client.query("INSERT INTO competition_stages(competition_id,parent_stage_id,programme_id,regulation_version_id,stage_level_code) VALUES($1,$2,$3,$4,'DAIRA')", [competition.rows[0].id, root.rows[0].id, programme.rows[0].id, derivedVersion.rows[0].id]), /same regulation version/);
      await expectDatabaseFailure(client, () => client.query("UPDATE competition_stages SET parent_stage_id=id WHERE id=$1", [root.rows[0].id]));
      await expectDatabaseFailure(client, () => client.query("INSERT INTO competition_stages(competition_id,parent_stage_id,programme_id,regulation_version_id,stage_level_code) VALUES($1,$2,$3,$4,'DAIRA')", [secondCompetition.rows[0].id, root.rows[0].id, programme.rows[0].id, version.rows[0].id]), /parent stage/);
      const otherProgramme = await client.query("INSERT INTO competition_programmes(season_id,code,title,effective_from) VALUES($1,'OTHER','Other','2094-01-01') RETURNING id", [season.rows[0].id]);
      const otherVersion = await client.query("INSERT INTO regulation_versions(version_no,programme_id,effective_period) VALUES('1.0',$1,'[2094-01-01,2095-01-01)') RETURNING id", [otherProgramme.rows[0].id]);
      const otherRegion = await client.query("INSERT INTO programme_regions(programme_id,regulation_version_id,code,name,effective_period) VALUES($1,$2,'R2','Region Two','[2094-01-01,2095-01-01)') RETURNING id", [otherProgramme.rows[0].id, otherVersion.rows[0].id]);
      const otherProgrammeRoot = await client.query("INSERT INTO competition_stages(competition_id,programme_id,regulation_version_id,stage_level_code) VALUES($1,$2,$3,'WILAYA') RETURNING id", [competition.rows[0].id, otherProgramme.rows[0].id, otherVersion.rows[0].id]);
      await expectDatabaseFailure(client, () => client.query("INSERT INTO competition_stages(competition_id,parent_stage_id,programme_id,regulation_version_id,stage_level_code) VALUES($1,$2,$3,$4,'DAIRA')", [competition.rows[0].id, otherProgrammeRoot.rows[0].id, programme.rows[0].id, version.rows[0].id]), /parent stage/);
      await expectDatabaseFailure(client, () => client.query("INSERT INTO competition_stages(competition_id,programme_id,programme_region_id,regulation_version_id,stage_level_code) VALUES($1,$2,$3,$4,'REGION')", [competition.rows[0].id, programme.rows[0].id, otherRegion.rows[0].id, version.rows[0].id]), /programme region/);
      await expectDatabaseFailure(client, () => client.query("INSERT INTO competition_stages(competition_id,programme_id,regulation_version_id,stage_level_code,start_date,end_date) VALUES($1,$2,$3,'WILAYA','2094-03-02','2094-03-01')", [competition.rows[0].id, programme.rows[0].id, version.rows[0].id]));
      await expectDatabaseFailure(client, () => client.query("INSERT INTO competition_stages(competition_id,programme_id,regulation_version_id,stage_level_code,start_date) VALUES($1,$2,$3,'WILAYA','2095-01-01')", [competition.rows[0].id, programme.rows[0].id, version.rows[0].id]), /competition season/);
      const narrowVersion = await client.query("INSERT INTO regulation_versions(version_no,programme_id,effective_period) VALUES('3.0',$1,'[2094-03-01,2094-12-31]') RETURNING id", [programme.rows[0].id]);
      await expectDatabaseFailure(client, () => client.query("INSERT INTO competition_stages(competition_id,programme_id,regulation_version_id,stage_level_code,start_date) VALUES($1,$2,$3,'WILAYA','2094-02-01')", [competition.rows[0].id, programme.rows[0].id, narrowVersion.rows[0].id]), /regulation effective period/);
      await expectDatabaseFailure(client, () => client.query("INSERT INTO competition_stages(competition_id,programme_id,regulation_version_id,stage_level_code,host_wilaya_id,host_daira_id) VALUES($1,$2,$3,'DAIRA',57,999001)", [competition.rows[0].id, programme.rows[0].id, version.rows[0].id]), /daira must belong/);
      await expectDatabaseFailure(client, () => client.query("INSERT INTO competition_stages(competition_id,programme_id,regulation_version_id,stage_level_code,host_wilaya_id,host_daira_id,host_commune_id) VALUES($1,$2,$3,'COMMUNE',58,999003,999001)", [competition.rows[0].id, programme.rows[0].id, version.rows[0].id]), /commune must belong/);
      await client.query("UPDATE competition_stages SET stage_level_code='WILAYA-UPDATED' WHERE id=$1", [root.rows[0].id]);
      await client.query("UPDATE competition_stages SET status='SCHEDULED' WHERE id=$1", [root.rows[0].id]);
      await client.query("UPDATE competition_stages SET status='ACTIVE' WHERE id=$1", [root.rows[0].id]);
      await expectDatabaseFailure(client, () => client.query("UPDATE competition_stages SET status='DRAFT' WHERE id=$1", [root.rows[0].id]), /forward-only/);
      await expectDatabaseFailure(client, () => client.query("UPDATE competition_stages SET stage_level_code='TAMPERED' WHERE id=$1", [root.rows[0].id]), /immutable/);
      await client.query("UPDATE competition_stages SET status='RESULTS' WHERE id=$1", [root.rows[0].id]);
      await client.query("UPDATE competition_stages SET status='CLOSED' WHERE id=$1", [root.rows[0].id]);
      await expectDatabaseFailure(client, () => client.query("UPDATE competition_stages SET status='ARCHIVED', stage_level_code='TAMPERED' WHERE id=$1", [root.rows[0].id]), /only transition/);
      await client.query("UPDATE competition_stages SET status='ARCHIVED' WHERE id=$1", [root.rows[0].id]);
      await expectDatabaseFailure(client, () => client.query("UPDATE competition_stages SET stage_level_code='TAMPERED' WHERE id=$1", [root.rows[0].id]), /immutable/);
      await expectDatabaseFailure(client, () => client.query("DELETE FROM competition_stages WHERE id=$1", [root.rows[0].id]));
      await client.query('ROLLBACK');
    } finally { client.release(); }
  });

  it('enforces occurrence context and venue assignments without global venue locking', async () => {
    const client = await pool!.connect();
    try {
      await client.query('BEGIN');
      await client.query("INSERT INTO wilayas(id,name,ar_name) VALUES(58,'Test Wilaya','ولاية تجريبية') ON CONFLICT (id) DO NOTHING");
      await client.query("INSERT INTO dairas(id,wilaya_id,name,ar_name) VALUES(999001,58,'Test Daira','دائرة تجريبية') ON CONFLICT (id) DO NOTHING");
      await client.query("INSERT INTO communes(id,daira_id,wilaya_id,name,ar_name) VALUES(999001,999001,58,'Test Commune','بلدية تجريبية') ON CONFLICT (id) DO NOTHING");
      const season = await client.query("INSERT INTO seasons(name,start_date,end_date) VALUES('OCCURRENCE-TEST','2093-01-01','2093-12-31') RETURNING id");
      const programme = await client.query("INSERT INTO competition_programmes(season_id,code,title,effective_from) VALUES($1,'OCCURRENCE','Occurrences','2093-01-01') RETURNING id", [season.rows[0].id]);
      const version = await client.query("INSERT INTO regulation_versions(version_no,programme_id,effective_period) VALUES('1.0',$1,'[2093-01-01,2094-01-01)') RETURNING id", [programme.rows[0].id]);
      const otherVersion = await client.query("INSERT INTO regulation_versions(version_no,programme_id,effective_period) VALUES('2.0',$1,'[2093-01-01,2094-01-01)') RETURNING id", [programme.rows[0].id]);
      const category = await client.query("INSERT INTO categories(programme_id,code,name,gender_code,regulation_version_id) VALUES($1,'U15','Under 15','OPEN',$2) RETURNING id", [programme.rows[0].id, version.rows[0].id]);
      const otherCategory = await client.query("INSERT INTO categories(programme_id,code,name,gender_code,regulation_version_id) VALUES($1,'U15','Under 15','OPEN',$2) RETURNING id", [programme.rows[0].id, otherVersion.rows[0].id]);
      const sport = await client.query("INSERT INTO sports(code,name,sport_type) VALUES('OCC','Occurrence Sport','INDIVIDUAL') RETURNING id");
      const event = await client.query("INSERT INTO events(sport_id,code,name,format,measurement_type) VALUES($1,'RUN','Run','INDIVIDUAL','TIME') RETURNING id", [sport.rows[0].id]);
      const source = await client.query("INSERT INTO regulation_sources(regulation_version_id,title,issuer) VALUES($1,'Source','Issuer') RETURNING id", [version.rows[0].id]);
      const competition = await client.query("INSERT INTO competitions(season_id,name) VALUES($1,'Occurrence Competition') RETURNING id", [season.rows[0].id]);
      const stage = await client.query("INSERT INTO competition_stages(competition_id,programme_id,regulation_version_id,stage_level_code,start_date,end_date) VALUES($1,$2,$3,'WILAYA','2093-02-01','2093-02-03') RETURNING id", [competition.rows[0].id, programme.rows[0].id, version.rows[0].id]);
      const occurrence = await client.query("INSERT INTO calendar_occurrences(stage_id,event_id,category_id,regulation_version_id,regulation_source_id,registration_open_at,registration_close_at,start_at,end_at) VALUES($1,$2,$3,$4,$5,'2093-02-01T08:00:00Z','2093-02-01T09:00:00Z','2093-02-02T08:00:00Z','2093-02-02T12:00:00Z') RETURNING id", [stage.rows[0].id, event.rows[0].id, category.rows[0].id, version.rows[0].id, source.rows[0].id]);
      await expectDatabaseFailure(client, () => client.query("INSERT INTO calendar_occurrences(stage_id,event_id,regulation_version_id) VALUES($1,$2,$3)", [stage.rows[0].id, event.rows[0].id, version.rows[0].id]));
      await expectDatabaseFailure(client, () => client.query("INSERT INTO calendar_occurrences(stage_id,event_id,regulation_version_id,registration_open_at,registration_close_at,start_at) VALUES($1,$2,$3,'2093-02-01T10:00:00Z','2093-02-01T09:00:00Z','2093-02-02T08:00:00Z')", [stage.rows[0].id, event.rows[0].id, version.rows[0].id]));
      await expectDatabaseFailure(client, () => client.query("INSERT INTO calendar_occurrences(stage_id,event_id,regulation_version_id,registration_open_at,start_at) VALUES($1,$2,$3,'2093-02-02T09:00:00Z','2093-02-02T08:00:00Z')", [stage.rows[0].id, event.rows[0].id, version.rows[0].id]));
      await expectDatabaseFailure(client, () => client.query("INSERT INTO calendar_occurrences(stage_id,event_id,regulation_version_id,registration_close_at,start_at) VALUES($1,$2,$3,'2093-02-02T09:00:00Z','2093-02-02T08:00:00Z')", [stage.rows[0].id, event.rows[0].id, version.rows[0].id]));
      await expectDatabaseFailure(client, () => client.query("INSERT INTO calendar_occurrences(stage_id,event_id,regulation_version_id,start_at,end_at) VALUES($1,$2,$3,'2093-02-02T12:00:00Z','2093-02-02T08:00:00Z')", [stage.rows[0].id, event.rows[0].id, version.rows[0].id]));
      await expectDatabaseFailure(client, () => client.query("INSERT INTO calendar_occurrences(stage_id,event_id,regulation_version_id,start_at,end_at) VALUES($1,$2,$3,'2093-02-02T08:00:00Z','2093-02-02T08:00:00Z')", [stage.rows[0].id, event.rows[0].id, version.rows[0].id]));
      await expectDatabaseFailure(client, () => client.query("INSERT INTO calendar_occurrences(stage_id,event_id,regulation_version_id,start_at) VALUES($1,$2,$3,'2093-02-02T08:00:00Z')", [stage.rows[0].id, event.rows[0].id, otherVersion.rows[0].id]), /regulation version/);
      await expectDatabaseFailure(client, () => client.query("INSERT INTO calendar_occurrences(stage_id,event_id,category_id,regulation_version_id,start_at) VALUES($1,$2,$3,$4,'2093-02-02T08:00:00Z')", [stage.rows[0].id, event.rows[0].id, otherCategory.rows[0].id, version.rows[0].id]), /category/);
      await client.query("UPDATE calendar_occurrences SET registration_close_at='2093-02-01T09:30:00Z' WHERE id=$1", [occurrence.rows[0].id]);
      await client.query("UPDATE calendar_occurrences SET status='APPROVED' WHERE id=$1", [occurrence.rows[0].id]);
      await client.query("UPDATE calendar_occurrences SET status='PUBLISHED' WHERE id=$1", [occurrence.rows[0].id]);
      await expectDatabaseFailure(client, () => client.query("UPDATE calendar_occurrences SET status='DRAFT' WHERE id=$1", [occurrence.rows[0].id]), /forward-only/);
      await expectDatabaseFailure(client, () => client.query("UPDATE calendar_occurrences SET start_at='2093-02-02T09:00:00Z' WHERE id=$1", [occurrence.rows[0].id]), /immutable/);
      await expectDatabaseFailure(client, () => client.query("DELETE FROM calendar_occurrences WHERE id=$1", [occurrence.rows[0].id]));
      await client.query("UPDATE calendar_occurrences SET status='COMPLETED' WHERE id=$1", [occurrence.rows[0].id]);
      await expectDatabaseFailure(client, () => client.query("UPDATE calendar_occurrences SET status='ARCHIVED', start_at='2093-02-02T09:00:00Z' WHERE id=$1", [occurrence.rows[0].id]), /only transition/);
      await client.query("UPDATE calendar_occurrences SET status='ARCHIVED' WHERE id=$1", [occurrence.rows[0].id]);
      await expectDatabaseFailure(client, () => client.query("UPDATE calendar_occurrences SET status='DRAFT' WHERE id=$1", [occurrence.rows[0].id]), /forward-only/);
      const venueA = await client.query("INSERT INTO venues(code,name,wilaya_id,daira_id,commune_id,address,technical_attributes) VALUES('VEN-A','Venue A',58,999001,999001,'Address A','{\"lanes\":6}') RETURNING id");
      const venueB = await client.query("INSERT INTO venues(code,name,wilaya_id) VALUES('VEN-B','Venue B',58) RETURNING id");
      await expectDatabaseFailure(client, () => client.query("INSERT INTO venues(code,name) VALUES('VEN-A','Duplicate')"));
      await expectDatabaseFailure(client, () => client.query("INSERT INTO venues(code,name,wilaya_id,daira_id) VALUES('VEN-C','Invalid',57,999001)"), /daira must belong/);
      await client.query("INSERT INTO occurrence_venues(calendar_occurrence_id,venue_id,start_at,end_at,role) VALUES($1,$2,'2093-02-02T08:00:00Z','2093-02-02T12:00:00Z','PRIMARY')", [occurrence.rows[0].id, venueA.rows[0].id]);
      await client.query("INSERT INTO occurrence_venues(calendar_occurrence_id,venue_id,start_at,end_at,role) VALUES($1,$2,'2093-02-02T08:00:00Z','2093-02-02T12:00:00Z','WARMUP')", [occurrence.rows[0].id, venueB.rows[0].id]);
      await expectDatabaseFailure(client, () => client.query("INSERT INTO occurrence_venues(calendar_occurrence_id,venue_id,start_at,end_at) VALUES($1,$2,'2093-02-02T12:00:00Z','2093-02-02T08:00:00Z')", [occurrence.rows[0].id, venueA.rows[0].id]));
      await expectDatabaseFailure(client, () => client.query("INSERT INTO occurrence_venues(calendar_occurrence_id,venue_id,start_at,end_at) VALUES($1,$2,'2093-02-02T08:00:00Z','2093-02-02T08:00:00Z')", [occurrence.rows[0].id, venueA.rows[0].id]));
      await expectDatabaseFailure(client, () => client.query("INSERT INTO occurrence_venues(calendar_occurrence_id,venue_id,start_at,end_at,role) VALUES($1,$2,'2093-02-02T08:00:00Z','2093-02-02T12:00:00Z','PRIMARY')", [occurrence.rows[0].id, venueA.rows[0].id]));
      await client.query('ROLLBACK');
    } finally { client.release(); }
  });
});
