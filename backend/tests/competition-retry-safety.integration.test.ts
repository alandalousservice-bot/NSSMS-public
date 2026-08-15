import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import pg from 'pg';
import { buildApp } from '../src/app.js';

const enabled = Boolean(process.env.DATABASE_URL && process.env.AUTH_SECRET);
const suite = enabled ? describe : describe.skip;
const pool = enabled ? new pg.Pool({ connectionString: process.env.DATABASE_URL }) : null;
const app = enabled ? buildApp() : null;
let sequence = 0;

async function login() {
  const response = await app!.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { username: 'institution.001.demo', password: 'NssmsInst-001-2026!' } });
  expect(response.statusCode).toBe(200);
  return { authorization: `Bearer ${response.json().token}` };
}

async function fixture(institutionId: string, actorId: string) {
  const tag = `A5R-${Date.now()}-${sequence++}`;
  const season = (await pool!.query("insert into seasons(name,start_date,end_date) values($1,'2060-01-01','2060-12-31') returning id", [tag])).rows[0].id;
  const programme = (await pool!.query("insert into competition_programmes(season_id,code,title,effective_from) values($1,$2,$2,'2060-01-01') returning id", [season, tag])).rows[0].id;
  const version = (await pool!.query("insert into regulation_versions(version_no,programme_id,effective_period) values('1',$1,'[2060-01-01,2061-01-01)') returning id", [programme])).rows[0].id;
  const source = (await pool!.query("insert into regulation_sources(regulation_version_id,title,issuer) values($1,$2,'NSSMS') returning id", [version, tag])).rows[0].id;
  const competition = (await pool!.query('insert into competitions(season_id,name) values($1,$2) returning id', [season, tag])).rows[0].id;
  const sourceStage = (await pool!.query("insert into competition_stages(competition_id,programme_id,regulation_version_id,stage_level_code) values($1,$2,$3,'W') returning id", [competition, programme, version])).rows[0].id;
  const destinationStage = (await pool!.query("insert into competition_stages(competition_id,parent_stage_id,programme_id,regulation_version_id,stage_level_code) values($1,$2,$3,$4,'D') returning id", [competition, sourceStage, programme, version])).rows[0].id;
  const category = (await pool!.query("insert into categories(programme_id,code,name,gender_code,regulation_version_id) values($1,$2,$2,'OPEN',$3) returning id", [programme, tag, version])).rows[0].id;
  const sport = (await pool!.query("insert into sports(code,name,sport_type) values($1,$1,'INDIVIDUAL') returning id", [tag])).rows[0].id;
  const event = (await pool!.query("insert into events(sport_id,code,name,format) values($1,$2,$2,'INDIVIDUAL') returning id", [sport, tag])).rows[0].id;
  const occurrence = (await pool!.query("insert into calendar_occurrences(stage_id,event_id,category_id,regulation_version_id,start_at) values($1,$2,$3,$4,'2060-02-01') returning id", [sourceStage, event, category, version])).rows[0].id;
  const participant = (await pool!.query("insert into participants(institution_id,given_name) values($1,'Retry') returning id", [institutionId])).rows[0].id;
  const entry = (await pool!.query("insert into competition_entries(stage_id,category_id,institution_id,entry_type,regulation_version_id) values($1,$2,$3,'INDIVIDUAL',$4) returning id", [sourceStage, category, institutionId, version])).rows[0].id;
  const destinationEntry = (await pool!.query("insert into competition_entries(stage_id,category_id,institution_id,entry_type,regulation_version_id) values($1,$2,$3,'INDIVIDUAL',$4) returning id", [destinationStage, category, institutionId, version])).rows[0].id;
  await pool!.query("insert into individual_entries(competition_entry_id,participant_id,stage_id,category_id,participation_state) values($1,$2,$3,$4,'DRAFT'),($5,$2,$6,$4,'DRAFT')", [entry, participant, sourceStage, category, destinationEntry, destinationStage]);
  const result = (await pool!.query("insert into results(competition_id,stage_id,occurrence_id,event_id,category_id,competition_entry_id,regulation_version_id,governed_status,result_data) values($1,$2,$3,$4,$5,$6,$7,'DRAFT','{}') returning id", [competition, sourceStage, occurrence, event, category, entry, version])).rows[0].id;
  const qualification = (await pool!.query("insert into qualifications(source_entry_id,source_stage_id,destination_stage_id,destination_entry_id,regulation_version_id,regulation_source_id,decision_type,reason,decided_by_user_id) values($1,$2,$3,$4,$5,$6,'MANUAL','retry approval',$7) returning id", [entry, sourceStage, destinationStage, destinationEntry, version, source, actorId])).rows[0].id;
  return { version, sourceStage, category, event, occurrence, entry, result, qualification };
}

function expectRetry(response: { statusCode: number; json: () => { error?: string } }) {
  expect([200, 409]).toContain(response.statusCode);
  if (response.statusCode === 409) expect(response.json().error).toMatch(/invalid_state|conflict/);
}

suite('ARCH-014 normal retry safety', () => {
  beforeAll(async () => { await app!.ready(); });
  afterAll(async () => { await app?.close(); await pool?.end(); });

  it('does not duplicate governed authority or overwrite provenance after a repeated successful command', async () => {
    const headers = await login();
    const me = await app!.inject({ method: 'GET', url: '/api/v1/auth/me', headers });
    const actorId = me.json().user.userId as string;
    const x = await fixture(me.json().user.institutionId as string, actorId);

    expect((await app!.inject({ method: 'POST', url: `/api/v1/admin/competition-results/${x.result}/submit`, headers })).statusCode).toBe(200);
    expect((await app!.inject({ method: 'POST', url: `/api/v1/admin/competition-results/${x.result}/validated`, headers, payload: { revisionNo: 0 } })).statusCode).toBe(200);
    const validation = (await pool!.query('select id,validator_user_id,decided_at from result_validations where result_id=$1 and decision=$2', [x.result, 'VALIDATED'])).rows[0];
    expectRetry(await app!.inject({ method: 'POST', url: `/api/v1/admin/competition-results/${x.result}/validated`, headers, payload: { revisionNo: 0 } }));
    const validations = (await pool!.query('select id,validator_user_id,decided_at from result_validations where result_id=$1 and decision=$2', [x.result, 'VALIDATED'])).rows;
    expect(validations).toHaveLength(1); expect(validations[0]).toMatchObject(validation);
    expect((await pool!.query('select count(*)::int as count from result_validations v where v.result_id=$1 and not exists(select 1 from result_validations s where s.supersedes_validation_id=v.id)', [x.result])).rows[0].count).toBe(1);

    expect((await app!.inject({ method: 'POST', url: `/api/v1/admin/qualifications/${x.qualification}/approve`, headers })).statusCode).toBe(200);
    const approved = (await pool!.query('select decided_by_user_id,decided_at from qualifications where id=$1', [x.qualification])).rows[0];
    expectRetry(await app!.inject({ method: 'POST', url: `/api/v1/admin/qualifications/${x.qualification}/approve`, headers }));
    const approvedAfter = (await pool!.query('select status,decided_by_user_id,decided_at from qualifications where id=$1', [x.qualification])).rows[0];
    expect(approvedAfter.status).toBe('APPROVED'); expect(approvedAfter).toMatchObject(approved);

    const ranking = (await pool!.query("insert into rankings(stage_id,occurrence_id,event_id,category_id,regulation_version_id,ranking_type,calculation_version,created_by_user_id) values($1,$2,$3,$4,$5,'EVENT','retry',$6) returning id,created_by_user_id,created_at", [x.sourceStage, x.occurrence, x.event, x.category, x.version, actorId])).rows[0];
    await pool!.query('insert into ranking_inputs(ranking_id,result_id,result_validation_id) values($1,$2,$3)', [ranking.id, x.result, validation.id]);
    await pool!.query('insert into ranking_rows(ranking_id,competition_entry_id,position) values($1,$2,1)', [ranking.id, x.entry]);
    expect((await app!.inject({ method: 'POST', url: `/api/v1/admin/rankings/${ranking.id}/validate`, headers })).statusCode).toBe(200);
    expectRetry(await app!.inject({ method: 'POST', url: `/api/v1/admin/rankings/${ranking.id}/validate`, headers }));
    expect((await pool!.query('select count(*)::int as count from rankings where id=$1 and status=$2', [ranking.id, 'VALIDATED'])).rows[0].count).toBe(1);
    expect((await app!.inject({ method: 'POST', url: `/api/v1/admin/rankings/${ranking.id}/publish`, headers })).statusCode).toBe(200);
    const published = (await pool!.query('select status,created_by_user_id,created_at from rankings where id=$1', [ranking.id])).rows[0];
    expectRetry(await app!.inject({ method: 'POST', url: `/api/v1/admin/rankings/${ranking.id}/publish`, headers }));
    const publishedAfter = (await pool!.query('select status,created_by_user_id,created_at from rankings where id=$1', [ranking.id])).rows[0];
    expect(publishedAfter.status).toBe('PUBLISHED'); expect(publishedAfter).toMatchObject(published);

    const award = (await pool!.query("insert into awards(ranking_id,competition_entry_id,award_type,regulation_version_id) values($1,$2,'MEDAL',$3) returning id", [ranking.id, x.entry, x.version])).rows[0].id;
    expect((await app!.inject({ method: 'POST', url: `/api/v1/admin/awards/${award}/issue`, headers })).statusCode).toBe(200);
    const issued = (await pool!.query('select issued_by_user_id,issued_at from awards where id=$1', [award])).rows[0];
    expectRetry(await app!.inject({ method: 'POST', url: `/api/v1/admin/awards/${award}/issue`, headers }));
    expect((await pool!.query('select status,issued_by_user_id,issued_at from awards where id=$1', [award])).rows[0]).toMatchObject({ status: 'ISSUED', ...issued });
    expect((await app!.inject({ method: 'POST', url: `/api/v1/admin/awards/${award}/revoke`, headers })).statusCode).toBe(200);
    const revoked = (await pool!.query('select issued_by_user_id,issued_at,revoked_by_user_id,revoked_at from awards where id=$1', [award])).rows[0];
    expectRetry(await app!.inject({ method: 'POST', url: `/api/v1/admin/awards/${award}/revoke`, headers }));
    expect((await pool!.query('select status,issued_by_user_id,issued_at,revoked_by_user_id,revoked_at from awards where id=$1', [award])).rows[0]).toMatchObject({ status: 'REVOKED', ...revoked });
  });
});
