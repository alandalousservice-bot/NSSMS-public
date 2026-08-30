import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import pg from 'pg';
import { buildApp } from '../src/app.js';

const enabled = Boolean(process.env.DATABASE_URL && process.env.AUTH_SECRET);
const suite = enabled ? describe : describe.skip;
const pool = enabled ? new pg.Pool({ connectionString: process.env.DATABASE_URL }) : null;
const app = enabled ? buildApp() : null;
let sequence = 0;

async function login(username: string, password: string) {
  const response = await app!.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { username, password } });
  expect(response.statusCode).toBe(200);
  return { authorization: `Bearer ${response.json().token}` };
}

async function fixture(institutionId: string, type: 'INDIVIDUAL'|'TEAM' = 'INDIVIDUAL') {
  const tag = `A2-${Date.now()}-${sequence++}`;
  const season = (await pool!.query("insert into seasons(name,start_date,end_date) values($1,'2065-01-01','2065-12-31') returning id", [tag])).rows[0].id;
  const programme = (await pool!.query("insert into competition_programmes(season_id,code,title,effective_from) values($1,$2,$2,'2065-01-01') returning id", [season, tag])).rows[0].id;
  const version = (await pool!.query("insert into regulation_versions(version_no,programme_id,effective_period) values('1',$1,'[2065-01-01,2066-01-01)') returning id", [programme])).rows[0].id;
  const competition = (await pool!.query('insert into competitions(season_id,name) values($1,$2) returning id', [season, tag])).rows[0].id;
  const stage = (await pool!.query("insert into competition_stages(competition_id,programme_id,regulation_version_id,stage_level_code) values($1,$2,$3,'W') returning id", [competition, programme, version])).rows[0].id;
  const sport = (await pool!.query("insert into sports(code,name,sport_type) values($1,$1,$2) returning id", [tag, type])).rows[0].id;
  const event = (await pool!.query("insert into events(sport_id,code,name,format) values($1,$2,$2,$3) returning id", [sport, tag, type])).rows[0].id;
  const category = (await pool!.query("insert into categories(programme_id,code,name,gender_code,regulation_version_id) values($1,$2,$2,'OPEN',$3) returning id", [programme, tag, version])).rows[0].id;
  const occurrence = (await pool!.query("insert into calendar_occurrences(stage_id,event_id,category_id,regulation_version_id,start_at) values($1,$2,$3,$4,'2065-02-01') returning id", [stage, event, category, version])).rows[0].id;
  const entry = (await pool!.query("insert into competition_entries(stage_id,category_id,institution_id,entry_type,regulation_version_id) values($1,$2,$3,$4,$5) returning id", [stage, category, institutionId, type, version])).rows[0].id;
  if (type === 'INDIVIDUAL') {
    const participant = (await pool!.query("insert into participants(institution_id,given_name) values($1,'Result Scope') returning id", [institutionId])).rows[0].id;
    await pool!.query("insert into individual_entries(competition_entry_id,participant_id,stage_id,category_id,participation_state) values($1,$2,$3,$4,'DRAFT')", [entry, participant, stage, category]);
  } else {
    const team = (await pool!.query("insert into teams(institution_id,category_id,stage_id,name) values($1,$2,$3,$4) returning id", [institutionId, category, stage, tag])).rows[0].id;
    await pool!.query("insert into team_entries(competition_entry_id,team_id,stage_id,category_id,participation_state) values($1,$2,$3,$4,'DRAFT')", [entry, team, stage, category]);
  }
  return { tag, season, programme, version, competition, stage, sport, event, category, occurrence, entry };
}

function resultBody(x: Awaited<ReturnType<typeof fixture>>) {
  return { competitionId: x.competition, stageId: x.stage, occurrenceId: x.occurrence, eventId: x.event, categoryId: x.category, competitionEntryId: x.entry, regulationVersionId: x.version, resultData: { score: 1 } };
}

async function expectRejected(headers: Record<string, string>, body: ReturnType<typeof resultBody>, entryId: string) {
  const response = await app!.inject({ method: 'POST', url: '/api/v1/admin/competition-results', headers, payload: body });
  expect([403, 422]).toContain(response.statusCode);
  expect(response.json().error).toMatch(/forbidden|invalid_context/);
  expect((await pool!.query('select count(*)::int as count from results where competition_entry_id=$1', [entryId])).rows[0].count).toBe(0);
}

suite('governed Result creation scope', () => {
  let institutionA = ''; let institutionB = '';
  beforeAll(async () => {
    await app!.ready();
    const organizations = await pool!.query("select id from organizations where code in ('WILAYA-01','WILAYA-02') order by code");
    institutionA = (await pool!.query('select id from educational_institutions where organization_id=$1 limit 1', [organizations.rows[0].id])).rows[0].id;
    institutionB = (await pool!.query('select id from educational_institutions where organization_id=$1 limit 1', [organizations.rows[1].id])).rows[0].id;
  });
  afterAll(async () => { await app?.close(); await pool?.end(); });

  it('allows an institution user to create Results for its own individual and team Entries only', async () => {
    const institution = await login('institution.001.demo', 'NssmsInst-001-2026!');
    const me = await app!.inject({ method: 'GET', url: '/api/v1/auth/me', headers: institution }), ownInstitution = me.json().user.institutionId as string;
    const ownIndividual = await fixture(ownInstitution), foreignIndividual = await fixture(institutionB), ownTeam = await fixture(ownInstitution, 'TEAM'), foreignTeam = await fixture(institutionB, 'TEAM');
    const own = await app!.inject({ method: 'POST', url: '/api/v1/admin/competition-results', headers: institution, payload: resultBody(ownIndividual) });
    expect(own.statusCode).toBe(200);
    const team = await app!.inject({ method: 'POST', url: '/api/v1/admin/competition-results', headers: institution, payload: resultBody(ownTeam) });
    expect(team.statusCode).toBe(200);
    await expectRejected(institution, resultBody(foreignIndividual), foreignIndividual.entry);
    await expectRejected(institution, resultBody(foreignTeam), foreignTeam.entry);
  });

  it('rejects association and daira attempts to create Results for foreign Entries', async () => {
    const association = await login('assoc.w01.admin', 'NssmsAssoc-W01-2026!'), daira = await login('daira.001.admin', 'NssmsDaira-001-2026!');
    const associationForeign = await fixture(institutionB);
    const dairaMe = await app!.inject({ method: 'GET', url: '/api/v1/auth/me', headers: daira });
    const dairaForeignInstitution = (await pool!.query('select id from educational_institutions where daira_id<>$1 limit 1', [dairaMe.json().user.dairaId])).rows[0].id;
    const dairaForeign = await fixture(dairaForeignInstitution);
    await expectRejected(association, resultBody(associationForeign), associationForeign.entry);
    await expectRejected(daira, resultBody(dairaForeign), dairaForeign.entry);
  });

  it('rejects mismatched governed Result context before inserting a Result row', async () => {
    const institution = await login('institution.001.demo', 'NssmsInst-001-2026!');
    const me = await app!.inject({ method: 'GET', url: '/api/v1/auth/me', headers: institution });
    const x = await fixture(me.json().user.institutionId as string);
    const otherStage = (await pool!.query("insert into competition_stages(competition_id,programme_id,regulation_version_id,stage_level_code) values($1,$2,$3,'D') returning id", [x.competition, x.programme, x.version])).rows[0].id;
    const otherEvent = (await pool!.query("insert into events(sport_id,code,name,format) values($1,$2,$2,'INDIVIDUAL') returning id", [x.sport, `${x.tag}-event`])).rows[0].id;
    const otherCategory = (await pool!.query("insert into categories(programme_id,code,name,gender_code,regulation_version_id) values($1,$2,$2,'OPEN',$3) returning id", [x.programme, `${x.tag}-category`, x.version])).rows[0].id;
    const otherOccurrence = (await pool!.query("insert into calendar_occurrences(stage_id,event_id,category_id,regulation_version_id,start_at) values($1,$2,$3,$4,'2065-03-01') returning id", [otherStage, otherEvent, otherCategory, x.version])).rows[0].id;
    const otherVersion = (await pool!.query("insert into regulation_versions(version_no,programme_id,effective_period) values('2',$1,'[2066-01-01,2067-01-01)') returning id", [x.programme])).rows[0].id;
    for (const payload of [{ ...resultBody(x), stageId: otherStage }, { ...resultBody(x), occurrenceId: otherOccurrence }, { ...resultBody(x), eventId: otherEvent }, { ...resultBody(x), categoryId: otherCategory }, { ...resultBody(x), regulationVersionId: otherVersion }]) await expectRejected(institution, payload, x.entry);
  });
});
