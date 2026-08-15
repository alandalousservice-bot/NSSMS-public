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

function noLeak(response: { body: string }) {
  expect(response.body).not.toMatch(/postgres|sql|constraint|trigger|plpgsql|stack|driver|detail|nssms_/i);
}

async function resultFixture(institutionId: string) {
  const tag = `B0-${Date.now()}-${sequence++}`;
  const season = (await pool!.query("insert into seasons(name,start_date,end_date) values($1,'2071-01-01','2071-12-31') returning id", [tag])).rows[0].id;
  const programme = (await pool!.query("insert into competition_programmes(season_id,code,title,effective_from) values($1,$2,$2,'2071-01-01') returning id", [season, tag])).rows[0].id;
  const version = (await pool!.query("insert into regulation_versions(version_no,programme_id,effective_period) values('1',$1,'[2071-01-01,2072-01-01)') returning id", [programme])).rows[0].id;
  const competition = (await pool!.query('insert into competitions(season_id,name) values($1,$2) returning id', [season, tag])).rows[0].id;
  const stage = (await pool!.query("insert into competition_stages(competition_id,programme_id,regulation_version_id,stage_level_code) values($1,$2,$3,'W') returning id", [competition, programme, version])).rows[0].id;
  const sport = (await pool!.query("insert into sports(code,name,sport_type) values($1,$1,'INDIVIDUAL') returning id", [tag])).rows[0].id;
  const event = (await pool!.query("insert into events(sport_id,code,name,format) values($1,$2,$2,'INDIVIDUAL') returning id", [sport, tag])).rows[0].id;
  const category = (await pool!.query("insert into categories(programme_id,code,name,gender_code,regulation_version_id) values($1,$2,$2,'OPEN',$3) returning id", [programme, tag, version])).rows[0].id;
  const occurrence = (await pool!.query("insert into calendar_occurrences(stage_id,event_id,category_id,regulation_version_id,start_at) values($1,$2,$3,$4,'2071-02-01') returning id", [stage, event, category, version])).rows[0].id;
  const participant = (await pool!.query("insert into participants(institution_id,given_name) values($1,'Archive') returning id", [institutionId])).rows[0].id;
  const entry = (await pool!.query("insert into competition_entries(stage_id,category_id,institution_id,entry_type,regulation_version_id) values($1,$2,$3,'INDIVIDUAL',$4) returning id", [stage, category, institutionId, version])).rows[0].id;
  await pool!.query("insert into individual_entries(competition_entry_id,participant_id,stage_id,category_id,participation_state) values($1,$2,$3,$4,'DRAFT')", [entry, participant, stage, category]);
  const result = (await pool!.query("insert into results(competition_id,stage_id,occurrence_id,event_id,category_id,competition_entry_id,regulation_version_id,governed_status,result_data) values($1,$2,$3,$4,$5,$6,$7,'DRAFT','{}') returning id", [competition, stage, occurrence, event, category, entry, version])).rows[0].id;
  const legacy = (await pool!.query("insert into results(competition_id,result_data) values($1,'{}') returning id", [competition])).rows[0].id;
  return { competition, result, legacy };
}

suite('governed Result archive HTTP contract', () => {
  beforeAll(async () => { await app!.ready(); });
  afterAll(async () => { await app?.close(); await pool?.end(); });

  it('archives scoped Results through the governed service and protects direct IDs', async () => {
    const institution = await login('institution.001.demo', 'NssmsInst-001-2026!');
    const association = await login('assoc.w01.admin', 'NssmsAssoc-W01-2026!');
    const daira = await login('daira.001.admin', 'NssmsDaira-001-2026!');
    const national = await login('demo.admin', 'NssmsDemoAdmin-2026!');
    const institutionMe = await app!.inject({ method: 'GET', url: '/api/v1/auth/me', headers: institution });
    const dairaMe = await app!.inject({ method: 'GET', url: '/api/v1/auth/me', headers: daira });
    const actorId = institutionMe.json().user.userId as string;
    const own = await resultFixture(institutionMe.json().user.institutionId as string);
    const associationForeignInstitution = (await pool!.query("select i.id from educational_institutions i join organizations o on o.id=i.organization_id where o.code='WILAYA-02' limit 1")).rows[0].id;
    const dairaForeignInstitution = (await pool!.query('select id from educational_institutions where daira_id<>$1 limit 1', [dairaMe.json().user.dairaId])).rows[0].id;
    const institutionForeign = await resultFixture(associationForeignInstitution);
    const associationForeign = await resultFixture(associationForeignInstitution);
    const dairaForeign = await resultFixture(dairaForeignInstitution);

    const archived = await app!.inject({ method: 'POST', url: `/api/v1/admin/competition-results/${own.result}/archive`, headers: institution });
    expect(archived.statusCode).toBe(200);
    expect(archived.json().data).toMatchObject({ id: own.result, governed_status: 'ARCHIVED' });
    expect(archived.json().data.archived_at).toBeTruthy();
    const stored = (await pool!.query('select governed_status,archived_at from results where id=$1', [own.result])).rows[0];
    expect(stored).toMatchObject({ governed_status: 'ARCHIVED' });
    expect(stored.archived_at).toBeTruthy();
    const audits = (await pool!.query("select actor_user_id,action,entity_type,entity_id,occurred_at from audit_logs where action='ARCHIVE' and entity_type='RESULT' and entity_id=$1", [own.result])).rows;
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({ actor_user_id: actorId, entity_id: own.result });
    expect(audits[0].occurred_at).toBeTruthy();

    for (const [headers, result] of [[institution, institutionForeign.result], [association, associationForeign.result], [daira, dairaForeign.result]] as const) {
      const response = await app!.inject({ method: 'POST', url: `/api/v1/admin/competition-results/${result}/archive`, headers });
      expect(response.statusCode).toBe(403);
      expect(response.json()).toEqual({ error: 'forbidden' });
      noLeak(response);
      expect((await pool!.query('select governed_status from results where id=$1', [result])).rows[0].governed_status).toBe('DRAFT');
      expect((await pool!.query("select count(*)::int as count from audit_logs where action='ARCHIVE' and entity_type='RESULT' and entity_id=$1", [result])).rows[0].count).toBe(0);
    }

    const missing = await app!.inject({ method: 'POST', url: '/api/v1/admin/competition-results/00000000-0000-0000-0000-000000000000/archive', headers: institution });
    expect(missing.statusCode).toBe(404);
    expect(missing.json()).toEqual({ error: 'not_found' });
    noLeak(missing);

    const legacy = await app!.inject({ method: 'POST', url: `/api/v1/admin/competition-results/${own.legacy}/archive`, headers: national });
    expect(legacy.statusCode).toBe(409);
    expect(legacy.json()).toEqual({ error: 'invalid_state' });
    noLeak(legacy);
    expect((await pool!.query('select governed_status from results where id=$1', [own.legacy])).rows[0].governed_status).toBe('LEGACY_UNRESOLVED');
  });
});
