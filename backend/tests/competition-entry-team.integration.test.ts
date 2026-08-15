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

async function createFixture(client: pg.PoolClient) {
  const organizationA = await client.query("INSERT INTO organizations(name,code) VALUES('Entry Organization A','ENTRY-ORG-A') RETURNING id");
  const organizationB = await client.query("INSERT INTO organizations(name,code) VALUES('Entry Organization B','ENTRY-ORG-B') RETURNING id");
  const institutionA = await client.query("INSERT INTO educational_institutions(organization_id,name,code) VALUES($1,'Entry Institution A','ENTRY-INS-A') RETURNING id", [organizationA.rows[0].id]);
  const institutionB = await client.query("INSERT INTO educational_institutions(organization_id,name,code) VALUES($1,'Entry Institution B','ENTRY-INS-B') RETURNING id", [organizationB.rows[0].id]);
  const participantA = await client.query("INSERT INTO participants(institution_id,given_name,family_name) VALUES($1,'Participant','A') RETURNING id", [institutionA.rows[0].id]);
  const participantB = await client.query("INSERT INTO participants(institution_id,given_name,family_name) VALUES($1,'Participant','B') RETURNING id", [institutionA.rows[0].id]);
  const participantOther = await client.query("INSERT INTO participants(institution_id,given_name,family_name) VALUES($1,'Participant','Other') RETURNING id", [institutionB.rows[0].id]);
  const season = await client.query("INSERT INTO seasons(name,start_date,end_date) VALUES('ENTRY-TEST','2092-01-01','2092-12-31') RETURNING id");
  const programme = await client.query("INSERT INTO competition_programmes(season_id,code,title,effective_from) VALUES($1,'ENTRY','Entry Programme','2092-01-01') RETURNING id", [season.rows[0].id]);
  const version = await client.query("INSERT INTO regulation_versions(version_no,programme_id,effective_period) VALUES('1.0',$1,'[2092-01-01,2093-01-01)') RETURNING id", [programme.rows[0].id]);
  const otherVersion = await client.query("INSERT INTO regulation_versions(version_no,programme_id,effective_period) VALUES('2.0',$1,'[2092-01-01,2093-01-01)') RETURNING id", [programme.rows[0].id]);
  const category = await client.query("INSERT INTO categories(programme_id,code,name,gender_code,regulation_version_id) VALUES($1,'U15','Under 15','OPEN',$2) RETURNING id", [programme.rows[0].id, version.rows[0].id]);
  const otherCategory = await client.query("INSERT INTO categories(programme_id,code,name,gender_code,regulation_version_id) VALUES($1,'U17','Under 17','OPEN',$2) RETURNING id", [programme.rows[0].id, version.rows[0].id]);
  const competition = await client.query("INSERT INTO competitions(season_id,name) VALUES($1,'Entry Competition') RETURNING id", [season.rows[0].id]);
  const stage = await client.query("INSERT INTO competition_stages(competition_id,programme_id,regulation_version_id,stage_level_code,start_date,end_date) VALUES($1,$2,$3,'WILAYA','2092-02-01','2092-02-03') RETURNING id", [competition.rows[0].id, programme.rows[0].id, version.rows[0].id]);
  const otherStage = await client.query("INSERT INTO competition_stages(competition_id,programme_id,regulation_version_id,stage_level_code,start_date,end_date) VALUES($1,$2,$3,'DAIRA','2092-02-01','2092-02-03') RETURNING id", [competition.rows[0].id, programme.rows[0].id, otherVersion.rows[0].id]);
  return {
    organizationA: organizationA.rows[0].id,
    institutionA: institutionA.rows[0].id,
    institutionB: institutionB.rows[0].id,
    participantA: participantA.rows[0].id,
    participantB: participantB.rows[0].id,
    participantOther: participantOther.rows[0].id,
    category: category.rows[0].id,
    otherCategory: otherCategory.rows[0].id,
    stage: stage.rows[0].id,
    otherStage: otherStage.rows[0].id,
    version: version.rows[0].id,
  };
}

suite('competition entry and team foundation migration', () => {
  beforeAll(async () => { await pool!.query('SELECT 1'); });
  afterAll(async () => { await pool?.end(); });

  it('creates only the participation foundation tables', async () => {
    const result = await pool!.query(
      "SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_name = ANY($1::text[])",
      [['teams', 'team_members', 'competition_entries', 'individual_entries', 'team_entries']],
    );
    expect(result.rows.map((row) => row.table_name).sort()).toEqual([
      'competition_entries', 'individual_entries', 'team_entries', 'team_members', 'teams',
    ]);
  });

  it('enforces governed teams and membership ownership/history', async () => {
    const client = await pool!.connect();
    try {
      await client.query('BEGIN');
      const fixture = await createFixture(client);
      const team = await client.query(
        "INSERT INTO teams(institution_id,category_id,stage_id,name) VALUES($1,$2,$3,'Institution A Team') RETURNING id",
        [fixture.institutionA, fixture.category, fixture.stage],
      );
      const member = await client.query(
        "INSERT INTO team_members(team_id,participant_id,role,valid_from) VALUES($1,$2,'ATHLETE','2092-01-01T00:00:00Z') RETURNING id",
        [team.rows[0].id, fixture.participantA],
      );
      expect(member.rows[0].id).toBeTruthy();
      await expectDatabaseFailure(client, () => client.query(
        "INSERT INTO team_members(team_id,participant_id,role,valid_from,valid_to) VALUES($1,$2,'ATHLETE','2092-02-02T00:00:00Z','2092-02-02T00:00:00Z')",
        [team.rows[0].id, fixture.participantB],
      ));
      await expectDatabaseFailure(client, () => client.query(
        "INSERT INTO team_members(team_id,participant_id,role) VALUES($1,$2,'ATHLETE')",
        [team.rows[0].id, fixture.participantOther],
      ), /team institution/);
      await expectDatabaseFailure(client, () => client.query(
        "INSERT INTO teams(institution_id,representing_organization_id,category_id,name) VALUES($1,$2,$3,'Ambiguous Team')",
        [fixture.institutionA, fixture.organizationA, fixture.category],
      ));
      await expectDatabaseFailure(client, () => client.query(
        "INSERT INTO teams(institution_id,category_id,stage_id,name) VALUES($1,$2,$3,'Wrong Context')",
        [fixture.institutionA, fixture.category, fixture.otherStage],
      ));
      await client.query('ROLLBACK');
    } finally { client.release(); }
  });

  it('enforces entry XOR, duplicate validation, and historical immutability', async () => {
    const client = await pool!.connect();
    try {
      await client.query('BEGIN');
      const fixture = await createFixture(client);
      const teamA = await client.query(
        "INSERT INTO teams(institution_id,category_id,stage_id,name) VALUES($1,$2,$3,'Team A') RETURNING id",
        [fixture.institutionA, fixture.category, fixture.stage],
      );
      const teamB = await client.query(
        "INSERT INTO teams(institution_id,category_id,stage_id,name) VALUES($1,$2,$3,'Team B') RETURNING id",
        [fixture.institutionA, fixture.category, fixture.stage],
      );
      const membership = await client.query("INSERT INTO team_members(team_id,participant_id,role) VALUES($1,$2,'ATHLETE') RETURNING id", [teamA.rows[0].id, fixture.participantA]);
      await client.query("UPDATE team_members SET role='RESERVE' WHERE id=$1", [membership.rows[0].id]);
      const draftMembership = await client.query("INSERT INTO team_members(team_id,participant_id,role) VALUES($1,$2,'ATHLETE') RETURNING id", [teamA.rows[0].id, fixture.participantB]);
      await client.query("UPDATE team_members SET role='RESERVE' WHERE id=$1", [draftMembership.rows[0].id]);
      await client.query('DELETE FROM team_members WHERE id=$1', [draftMembership.rows[0].id]);

      const individual = await client.query(
        "INSERT INTO competition_entries(stage_id,category_id,institution_id,entry_type,regulation_version_id,eligibility_data) VALUES($1,$2,$3,'INDIVIDUAL',$4,'{}') RETURNING id",
        [fixture.stage, fixture.category, fixture.institutionA, fixture.version],
      );
      await client.query(
        "INSERT INTO individual_entries(competition_entry_id,participant_id,stage_id,category_id,participation_state) VALUES($1,$2,$3,$4,'DRAFT')",
        [individual.rows[0].id, fixture.participantA, fixture.stage, fixture.category],
      );
      await client.query("UPDATE competition_entries SET eligibility_data='{\"note\":\"draft edit\"}' WHERE id=$1", [individual.rows[0].id]);
      await expectDatabaseFailure(client, () => client.query(
        "INSERT INTO individual_entries(competition_entry_id,participant_id,stage_id,category_id,participation_state) VALUES($1,$2,$3,$4,'DRAFT')",
        [individual.rows[0].id, fixture.participantB, fixture.otherStage, fixture.category],
      ), /stage must match/);
      await expectDatabaseFailure(client, () => client.query(
        "INSERT INTO individual_entries(competition_entry_id,participant_id,stage_id,category_id,participation_state) VALUES($1,$2,$3,$4,'DRAFT')",
        [individual.rows[0].id, fixture.participantB, fixture.stage, fixture.otherCategory],
      ), /category must match/);
      await expectDatabaseFailure(client, () => client.query(
        "INSERT INTO team_entries(competition_entry_id,team_id,stage_id,category_id,participation_state) VALUES($1,$2,$3,$4,'DRAFT')",
        [individual.rows[0].id, teamA.rows[0].id, fixture.stage, fixture.category],
      ), /must match a TEAM/);
      await client.query("UPDATE competition_entries SET status='SUBMITTED' WHERE id=$1", [individual.rows[0].id]);
      await client.query("UPDATE competition_entries SET status='VALIDATED' WHERE id=$1", [individual.rows[0].id]);
      await expectDatabaseFailure(client, () => client.query("UPDATE competition_entries SET category_id=$1 WHERE id=$2", [fixture.otherCategory, individual.rows[0].id]), /immutable/);
      await expectDatabaseFailure(client, () => client.query("UPDATE individual_entries SET participant_id=$1 WHERE competition_entry_id=$2", [fixture.participantB, individual.rows[0].id]), /immutable/);
      const validatedIndividual = await client.query('SELECT archived_at FROM competition_entries WHERE id=$1', [individual.rows[0].id]);
      expect(validatedIndividual.rows[0].archived_at).toBeNull();
      await expectDatabaseFailure(client, () => client.query("UPDATE competition_entries SET status='ARCHIVED', archived_at='2099-01-01T00:00:00Z' WHERE id=$1", [individual.rows[0].id]), /database-controlled/);
      await expectDatabaseFailure(client, () => client.query("UPDATE competition_entries SET status='ARCHIVED', category_id=$1 WHERE id=$2", [fixture.otherCategory, individual.rows[0].id]), /only transition/);
      const archivedIndividual = await client.query("UPDATE competition_entries SET status='ARCHIVED' WHERE id=$1 RETURNING archived_at", [individual.rows[0].id]);
      expect(archivedIndividual.rows[0].archived_at).toBeTruthy();
      await expectDatabaseFailure(client, () => client.query("UPDATE competition_entries SET archived_at='2099-01-01T00:00:00Z' WHERE id=$1", [individual.rows[0].id]), /immutable/);
      await expectDatabaseFailure(client, () => client.query('DELETE FROM individual_entries WHERE competition_entry_id=$1', [individual.rows[0].id]), /cannot be deleted/);
      await expectDatabaseFailure(client, () => client.query('DELETE FROM competition_entries WHERE id=$1', [individual.rows[0].id]), /cannot be deleted/);

      const teamEntry = await client.query(
        "INSERT INTO competition_entries(stage_id,category_id,institution_id,entry_type,regulation_version_id) VALUES($1,$2,$3,'TEAM',$4) RETURNING id",
        [fixture.stage, fixture.category, fixture.institutionA, fixture.version],
      );
      await client.query(
        "INSERT INTO team_entries(competition_entry_id,team_id,stage_id,category_id,participation_state) VALUES($1,$2,$3,$4,'DRAFT')",
        [teamEntry.rows[0].id, teamA.rows[0].id, fixture.stage, fixture.category],
      );
      await client.query("UPDATE competition_entries SET status='SUBMITTED' WHERE id=$1", [teamEntry.rows[0].id]);
      await client.query("UPDATE competition_entries SET status='VALIDATED' WHERE id=$1", [teamEntry.rows[0].id]);
      await expectDatabaseFailure(client, () => client.query("UPDATE team_members SET participant_id=$1 WHERE id=$2", [fixture.participantB, membership.rows[0].id]), /immutable/);
      await expectDatabaseFailure(client, () => client.query("UPDATE team_members SET team_id=$1 WHERE id=$2", [teamB.rows[0].id, membership.rows[0].id]), /immutable/);
      await expectDatabaseFailure(client, () => client.query("UPDATE team_members SET role='ATHLETE' WHERE id=$1", [membership.rows[0].id]), /immutable/);
      await expectDatabaseFailure(client, () => client.query("UPDATE team_members SET valid_from='2092-01-01T00:00:00Z' WHERE id=$1", [membership.rows[0].id]), /immutable/);
      await expectDatabaseFailure(client, () => client.query("UPDATE team_members SET valid_to='2092-02-01T00:00:00Z' WHERE id=$1", [membership.rows[0].id]), /immutable/);
      await expectDatabaseFailure(client, () => client.query('DELETE FROM team_members WHERE id=$1', [membership.rows[0].id]), /cannot be deleted/);
      await expectDatabaseFailure(client, () => client.query("INSERT INTO team_members(team_id,participant_id,role) VALUES($1,$2,'ATHLETE')", [teamA.rows[0].id, fixture.participantB]), /cannot be added/);
      await client.query("UPDATE competition_entries SET status='WITHDRAWN' WHERE id=$1", [teamEntry.rows[0].id]);
      const withdrawnTeam = await client.query('SELECT archived_at FROM competition_entries WHERE id=$1', [teamEntry.rows[0].id]);
      expect(withdrawnTeam.rows[0].archived_at).toBeNull();
      await expectDatabaseFailure(client, () => client.query("INSERT INTO team_members(team_id,participant_id,role) VALUES($1,$2,'ATHLETE')", [teamA.rows[0].id, fixture.participantB]), /cannot be added/);
      const archivedTeam = await client.query("UPDATE competition_entries SET status='ARCHIVED' WHERE id=$1 RETURNING archived_at", [teamEntry.rows[0].id]);
      expect(archivedTeam.rows[0].archived_at).toBeTruthy();
      await expectDatabaseFailure(client, () => client.query("INSERT INTO team_members(team_id,participant_id,role) VALUES($1,$2,'ATHLETE')", [teamA.rows[0].id, fixture.participantB]), /cannot be added/);

      const noSubtype = await client.query(
        "INSERT INTO competition_entries(stage_id,category_id,institution_id,entry_type,regulation_version_id) VALUES($1,$2,$3,'INDIVIDUAL',$4) RETURNING id",
        [fixture.stage, fixture.category, fixture.institutionA, fixture.version],
      );
      await expectDatabaseFailure(client, async () => {
        await client.query("UPDATE competition_entries SET status='SUBMITTED' WHERE id=$1", [noSubtype.rows[0].id]);
        await client.query("UPDATE competition_entries SET status='VALIDATED' WHERE id=$1", [noSubtype.rows[0].id]);
        await client.query('SET CONSTRAINTS ALL IMMEDIATE');
      }, /exactly one subtype/);

      const individualDuplicateA = await client.query(
        "INSERT INTO competition_entries(stage_id,category_id,institution_id,entry_type,regulation_version_id) VALUES($1,$2,$3,'INDIVIDUAL',$4) RETURNING id",
        [fixture.stage, fixture.category, fixture.institutionA, fixture.version],
      );
      const individualDuplicateB = await client.query(
        "INSERT INTO competition_entries(stage_id,category_id,institution_id,entry_type,regulation_version_id) VALUES($1,$2,$3,'INDIVIDUAL',$4) RETURNING id",
        [fixture.stage, fixture.category, fixture.institutionA, fixture.version],
      );
      await client.query("INSERT INTO individual_entries(competition_entry_id,participant_id,stage_id,category_id,participation_state) VALUES($1,$2,$3,$4,'DRAFT')", [individualDuplicateA.rows[0].id, fixture.participantB, fixture.stage, fixture.category]);
      await client.query("INSERT INTO individual_entries(competition_entry_id,participant_id,stage_id,category_id,participation_state) VALUES($1,$2,$3,$4,'DRAFT')", [individualDuplicateB.rows[0].id, fixture.participantB, fixture.stage, fixture.category]);
      await client.query("UPDATE competition_entries SET status='SUBMITTED' WHERE id=$1", [individualDuplicateA.rows[0].id]);
      await client.query("UPDATE competition_entries SET status='SUBMITTED' WHERE id=$1", [individualDuplicateB.rows[0].id]);
      await client.query("UPDATE competition_entries SET status='VALIDATED' WHERE id=$1", [individualDuplicateA.rows[0].id]);
      await expectDatabaseFailure(client, () => client.query("UPDATE competition_entries SET status='VALIDATED' WHERE id=$1", [individualDuplicateB.rows[0].id]));

      const teamDuplicateA = await client.query(
        "INSERT INTO competition_entries(stage_id,category_id,institution_id,entry_type,regulation_version_id) VALUES($1,$2,$3,'TEAM',$4) RETURNING id",
        [fixture.stage, fixture.category, fixture.institutionA, fixture.version],
      );
      const teamDuplicateB = await client.query(
        "INSERT INTO competition_entries(stage_id,category_id,institution_id,entry_type,regulation_version_id) VALUES($1,$2,$3,'TEAM',$4) RETURNING id",
        [fixture.stage, fixture.category, fixture.institutionA, fixture.version],
      );
      await client.query("INSERT INTO team_entries(competition_entry_id,team_id,stage_id,category_id,participation_state) VALUES($1,$2,$3,$4,'DRAFT')", [teamDuplicateA.rows[0].id, teamB.rows[0].id, fixture.stage, fixture.category]);
      await client.query("INSERT INTO team_entries(competition_entry_id,team_id,stage_id,category_id,participation_state) VALUES($1,$2,$3,$4,'DRAFT')", [teamDuplicateB.rows[0].id, teamB.rows[0].id, fixture.stage, fixture.category]);
      await client.query("UPDATE competition_entries SET status='SUBMITTED' WHERE id=$1", [teamDuplicateA.rows[0].id]);
      await client.query("UPDATE competition_entries SET status='SUBMITTED' WHERE id=$1", [teamDuplicateB.rows[0].id]);
      await client.query("UPDATE competition_entries SET status='VALIDATED' WHERE id=$1", [teamDuplicateA.rows[0].id]);
      await expectDatabaseFailure(client, () => client.query("UPDATE competition_entries SET status='VALIDATED' WHERE id=$1", [teamDuplicateB.rows[0].id]));
      await client.query('ROLLBACK');
    } finally { client.release(); }
  });
});
