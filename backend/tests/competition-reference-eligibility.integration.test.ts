import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import pg from 'pg';
import { buildApp } from '../src/app.js';

const enabled = Boolean(process.env.DATABASE_URL && process.env.AUTH_SECRET);
const suite = enabled ? describe : describe.skip;
const pool = enabled ? new pg.Pool({ connectionString: process.env.DATABASE_URL }) : null;
const app = enabled ? buildApp() : null;
let sequence = 0;
async function login(username: string, password: string) { const r = await app!.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { username, password } }); expect(r.statusCode).toBe(200); return { authorization: `Bearer ${r.json().token}` }; }
function noLeak(response: { body: string }) { expect(response.body).not.toMatch(/postgres|sql|constraint|trigger|plpgsql|stack|driver|detail|nssms_/i); }

async function fixture(institutionId: string, hostOrganizationId: string) {
  const tag = `B1-${Date.now()}-${sequence++}`;
  const season = (await pool!.query("insert into seasons(name,start_date,end_date) values($1,'2072-01-01','2072-12-31') returning id", [tag])).rows[0].id;
  const programme = (await pool!.query("insert into competition_programmes(season_id,code,title,effective_from) values($1,$2,$2,'2072-01-01') returning id", [season, tag])).rows[0].id;
  const version = (await pool!.query("insert into regulation_versions(version_no,programme_id,effective_period) values('1',$1,'[2072-01-01,2073-01-01)') returning id", [programme])).rows[0].id;
  const competition = (await pool!.query('insert into competitions(season_id,name) values($1,$2) returning id', [season, tag])).rows[0].id;
  const stage = (await pool!.query("insert into competition_stages(competition_id,programme_id,regulation_version_id,stage_level_code,host_organization_id) values($1,$2,$3,'W',$4) returning id", [competition, programme, version, hostOrganizationId])).rows[0].id;
  const sport = (await pool!.query("insert into sports(code,name,sport_type) values($1,$1,'TEAM') returning id", [tag])).rows[0].id;
  const event = (await pool!.query("insert into events(sport_id,code,name,format) values($1,$2,$2,'TEAM') returning id", [sport, tag])).rows[0].id;
  const category = (await pool!.query("insert into categories(programme_id,code,name,gender_code,regulation_version_id) values($1,$2,$2,'OPEN',$3) returning id", [programme, tag, version])).rows[0].id;
  const occurrence = (await pool!.query("insert into calendar_occurrences(stage_id,event_id,category_id,regulation_version_id,start_at) values($1,$2,$3,$4,'2072-02-01') returning id", [stage, event, category, version])).rows[0].id;
  const participant = (await pool!.query("insert into participants(institution_id,given_name) values($1,'Eligibility') returning id", [institutionId])).rows[0].id;
  const team = (await pool!.query("insert into teams(institution_id,stage_id,category_id,name) values($1,$2,$3,$4) returning id", [institutionId, stage, category, tag])).rows[0].id;
  return { competition, stage, version, event, category, occurrence, participant, team };
}

suite('ARCH-016 stage eligibility and scoped competition references', () => {
  beforeAll(async () => { await app!.ready(); }); afterAll(async () => { await app?.close(); await pool?.end(); });
  it('enforces eligibility invariants and draft-only configuration without host inference', async () => {
    const national = await login('demo.admin', 'NssmsDemoAdmin-2026!');
    const institution = await login('institution.001.demo', 'NssmsInst-001-2026!');
    const me = await app!.inject({ method: 'GET', url: '/api/v1/auth/me', headers: institution });
    const organization = (await pool!.query("select id from organizations where code='WILAYA-01'")).rows[0].id;
    const x = await fixture(me.json().user.institutionId, organization);
    const before = await app!.inject({ method: 'GET', url: `/api/v1/admin/competition-reference/stages?competition_id=${x.competition}`, headers: institution });
    expect(before.statusCode).toBe(200); expect(before.json().data).toEqual([]); // Host is not eligibility.
    await expect(pool!.query("insert into competition_stage_scope_eligibility(stage_id,scope_type,organization_id,daira_id) values($1,'ORGANIZATION',$2,1)", [x.stage, organization])).rejects.toBeTruthy();
    await expect(pool!.query("insert into competition_stage_scope_eligibility(stage_id,scope_type,organization_id) values('00000000-0000-0000-0000-000000000000','ORGANIZATION',$1)", [organization])).rejects.toBeTruthy();
    await pool!.query("insert into competition_stage_scope_eligibility(stage_id,scope_type,institution_id) values($1,'INSTITUTION',$2)", [x.stage, me.json().user.institutionId]);
    await expect(pool!.query("insert into competition_stage_scope_eligibility(stage_id,scope_type,institution_id) values($1,'INSTITUTION',$2)", [x.stage, me.json().user.institutionId])).rejects.toBeTruthy();
    await pool!.query("update competition_stages set status='SCHEDULED' where id=$1", [x.stage]);
    await expect(pool!.query("update competition_stage_scope_eligibility set created_at=created_at where stage_id=$1", [x.stage])).rejects.toBeTruthy();
    await expect(pool!.query("delete from competition_stage_scope_eligibility where stage_id=$1", [x.stage])).rejects.toBeTruthy();
    expect((await pool!.query('select id from competition_stages where id=$1', [x.stage])).rowCount).toBe(1);
    const denied = await app!.inject({ method: 'POST', url: `/api/v1/admin/competition-stages/${x.stage}/eligibility`, headers: institution, payload: { scopeType: 'INSTITUTION', institutionId: me.json().user.institutionId } });
    expect(denied.statusCode).toBe(403); noLeak(denied);
    const invalid = await app!.inject({ method: 'GET', url: '/api/v1/admin/competition-reference/stages?competition_id=invalid', headers: national });
    expect(invalid.statusCode).toBe(422); expect(invalid.json().error).toBe('validation_error'); noLeak(invalid);
  });

  it('discovers eligible first-entry context and excludes foreign organization, daira, institution, and team resources', async () => {
    const national = await login('demo.admin', 'NssmsDemoAdmin-2026!');
    const nationalUserId = (await pool!.query("select id from users where username='demo.admin'")).rows[0].id;
    const institution = await login('institution.001.demo', 'NssmsInst-001-2026!');
    const association = await login('assoc.w01.admin', 'NssmsAssoc-W01-2026!');
    const daira = await login('daira.001.admin', 'NssmsDaira-001-2026!');
    const institutionMe = await app!.inject({ method: 'GET', url: '/api/v1/auth/me', headers: institution });
    const dairaMe = await app!.inject({ method: 'GET', url: '/api/v1/auth/me', headers: daira });
    const organizationA = (await pool!.query("select id from organizations where code='WILAYA-01'")).rows[0].id;
    const institutionB = (await pool!.query("select i.id from educational_institutions i join organizations o on o.id=i.organization_id where o.code='WILAYA-02' limit 1")).rows[0].id;
    const x = await fixture(institutionMe.json().user.institutionId, organizationA);
    const foreign = await fixture(institutionB, (await pool!.query("select id from organizations where code='WILAYA-02'")).rows[0].id);
    for (const payload of [{ scopeType: 'INSTITUTION', institutionId: institutionMe.json().user.institutionId }, { scopeType: 'ORGANIZATION', organizationId: organizationA }, { scopeType: 'DAIRA', dairaId: Number(dairaMe.json().user.dairaId) }]) {
      const r = await app!.inject({ method: 'POST', url: `/api/v1/admin/competition-stages/${x.stage}/eligibility`, headers: national, payload }); expect(r.statusCode).toBe(200);
    }
    const removable = await app!.inject({ method: 'POST', url: `/api/v1/admin/competition-stages/${x.stage}/eligibility`, headers: national, payload: { scopeType: 'ORGANIZATION', organizationId: (await pool!.query("select id from organizations where code='WILAYA-02'")).rows[0].id } });
    expect(removable.statusCode).toBe(200);
    expect((await app!.inject({ method: 'DELETE', url: `/api/v1/admin/competition-stages/${x.stage}/eligibility/${removable.json().data.id}`, headers: national })).statusCode).toBe(200);
    const stages = await app!.inject({ method: 'GET', url: `/api/v1/admin/competition-reference/stages?competition_id=${x.competition}&limit=25&offset=0`, headers: institution });
    expect(stages.statusCode).toBe(200); expect(stages.json()).toMatchObject({ data: [{ id: x.stage }], meta: { pagination: { limit: 25, offset: 0 } } });
    const foreignStages = await app!.inject({ method: 'GET', url: `/api/v1/admin/competition-reference/stages?competition_id=${foreign.competition}`, headers: institution }); expect(foreignStages.json().data).toEqual([]);
    for (const resource of ['occurrences', 'events', 'categories', 'regulation-versions'] as const) { const r = await app!.inject({ method: 'GET', url: `/api/v1/admin/competition-reference/${resource}?stage_id=${x.stage}`, headers: institution }); expect(r.statusCode).toBe(200); expect(r.json().data).toHaveLength(1); }
    const teams = await app!.inject({ method: 'GET', url: `/api/v1/admin/competition-reference/teams?stage_id=${x.stage}&category_id=${x.category}`, headers: institution }); expect(teams.statusCode).toBe(200); expect(teams.json().data).toMatchObject([{ id: x.team }]);
    const foreignTeam = await app!.inject({ method: 'GET', url: `/api/v1/admin/competition-reference/teams?stage_id=${foreign.stage}&category_id=${foreign.category}`, headers: institution }); expect(foreignTeam.json().data).toEqual([]);
    const firstEntry = await app!.inject({ method: 'POST', url: '/api/v1/admin/competition-entries', headers: institution, payload: { stageId: x.stage, categoryId: x.category, institutionId: institutionMe.json().user.institutionId, regulationVersionId: x.version, participantId: x.participant } });
    expect(firstEntry.statusCode).toBe(200);
    const audit = (await pool!.query("select action,actor_user_id from audit_logs where entity_type='COMPETITION_STAGE' and entity_id=$1 and action in ('ADD_ELIGIBILITY','REMOVE_ELIGIBILITY')", [x.stage])).rows;
    expect(audit.filter((row) => row.action === 'ADD_ELIGIBILITY')).toHaveLength(4); expect(audit.filter((row) => row.action === 'REMOVE_ELIGIBILITY')).toHaveLength(1); expect(audit.every((row) => row.actor_user_id === nationalUserId)).toBe(true);
    expect((await app!.inject({ method: 'GET', url: `/api/v1/admin/competition-reference/stages?competition_id=${x.competition}`, headers: association })).json().data).toMatchObject([{ id: x.stage }]);
    expect((await app!.inject({ method: 'GET', url: `/api/v1/admin/competition-reference/stages?competition_id=${x.competition}`, headers: daira })).json().data).toMatchObject([{ id: x.stage }]);
  });
});
