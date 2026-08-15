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

async function bundle(institutionId: string, actorId: string) {
  const tag = `A5I-${Date.now()}-${sequence++}`;
  const season = (await pool!.query("insert into seasons(name,start_date,end_date) values($1,'2059-01-01','2059-12-31') returning id", [tag])).rows[0].id;
  const programme = (await pool!.query("insert into competition_programmes(season_id,code,title,effective_from) values($1,$2,$2,'2059-01-01') returning id", [season, tag])).rows[0].id;
  const version = (await pool!.query("insert into regulation_versions(version_no,programme_id,effective_period) values('1',$1,'[2059-01-01,2060-01-01)') returning id", [programme])).rows[0].id;
  const source = (await pool!.query("insert into regulation_sources(regulation_version_id,title,issuer) values($1,$2,'NSSMS') returning id", [version, tag])).rows[0].id;
  const competition = (await pool!.query('insert into competitions(season_id,name) values($1,$2) returning id', [season, tag])).rows[0].id;
  const stage = (await pool!.query("insert into competition_stages(competition_id,programme_id,regulation_version_id,stage_level_code) values($1,$2,$3,'W') returning id", [competition, programme, version])).rows[0].id;
  const destinationStage = (await pool!.query("insert into competition_stages(competition_id,parent_stage_id,programme_id,regulation_version_id,stage_level_code) values($1,$2,$3,$4,'D') returning id", [competition, stage, programme, version])).rows[0].id;
  const category = (await pool!.query("insert into categories(programme_id,code,name,gender_code,regulation_version_id) values($1,$2,$2,'OPEN',$3) returning id", [programme, tag, version])).rows[0].id;
  const sport = (await pool!.query("insert into sports(code,name,sport_type) values($1,$1,'INDIVIDUAL') returning id", [tag])).rows[0].id;
  const event = (await pool!.query("insert into events(sport_id,code,name,format) values($1,$2,$2,'INDIVIDUAL') returning id", [sport, tag])).rows[0].id;
  const occurrence = (await pool!.query("insert into calendar_occurrences(stage_id,event_id,category_id,regulation_version_id,start_at) values($1,$2,$3,$4,'2059-02-01') returning id", [stage, event, category, version])).rows[0].id;
  const participant = (await pool!.query("insert into participants(institution_id,given_name) values($1,'IDOR') returning id", [institutionId])).rows[0].id;
  const entry = (await pool!.query("insert into competition_entries(stage_id,category_id,institution_id,entry_type,regulation_version_id) values($1,$2,$3,'INDIVIDUAL',$4) returning id", [stage, category, institutionId, version])).rows[0].id;
  const destinationEntry = (await pool!.query("insert into competition_entries(stage_id,category_id,institution_id,entry_type,regulation_version_id) values($1,$2,$3,'INDIVIDUAL',$4) returning id", [destinationStage, category, institutionId, version])).rows[0].id;
  await pool!.query("insert into individual_entries(competition_entry_id,participant_id,stage_id,category_id,participation_state) values($1,$2,$3,$4,'DRAFT'),($5,$2,$6,$4,'DRAFT')", [entry, participant, stage, category, destinationEntry, destinationStage]);
  const result = (await pool!.query("insert into results(competition_id,stage_id,occurrence_id,event_id,category_id,competition_entry_id,regulation_version_id,governed_status,result_data) values($1,$2,$3,$4,$5,$6,$7,'DRAFT','{}') returning id", [competition, stage, occurrence, event, category, entry, version])).rows[0].id;
  const qualification = (await pool!.query("insert into qualifications(source_entry_id,source_stage_id,destination_stage_id,destination_entry_id,regulation_version_id,regulation_source_id,decision_type,reason,decided_by_user_id) values($1,$2,$3,$4,$5,$6,'MANUAL','IDOR',$7) returning id", [entry, stage, destinationStage, destinationEntry, version, source, actorId])).rows[0].id;
  const ranking = (await pool!.query("insert into rankings(stage_id,occurrence_id,event_id,category_id,regulation_version_id,ranking_type,calculation_version,created_by_user_id) values($1,$2,$3,$4,$5,'EVENT',$6,$7) returning id", [stage, occurrence, event, category, version, tag, actorId])).rows[0].id;
  const award = (await pool!.query("insert into awards(competition_entry_id,award_type,regulation_version_id) values($1,'MEDAL',$2) returning id", [entry, version])).rows[0].id;
  return { entry, result, qualification, ranking, award };
}

function noLeak(response: { body: string }) { expect(response.body).not.toMatch(/postgres|sql|constraint|trigger|plpgsql|stack|driver|detail|nssms_/i); }

suite('ARCH-014 five-domain direct-ID IDOR matrix', () => {
  beforeAll(async () => { await app!.ready(); });
  afterAll(async () => { await app?.close(); await pool?.end(); });

  it('distinguishes own, foreign, and missing governed resources without state or audit side effects', async () => {
    const institution = await login('institution.001.demo', 'NssmsInst-001-2026!');
    const association = await login('assoc.w01.admin', 'NssmsAssoc-W01-2026!');
    const daira = await login('daira.001.admin', 'NssmsDaira-001-2026!');
    const [institutionMe, associationMe, dairaMe] = await Promise.all([app!.inject({ method: 'GET', url: '/api/v1/auth/me', headers: institution }), app!.inject({ method: 'GET', url: '/api/v1/auth/me', headers: association }), app!.inject({ method: 'GET', url: '/api/v1/auth/me', headers: daira })]);
    const institutionId = institutionMe.json().user.institutionId as string;
    const associationOwnInstitution = (await pool!.query('select id from educational_institutions where organization_id=$1 limit 1', [associationMe.json().user.organizationId])).rows[0].id;
    const dairaOwnInstitution = (await pool!.query('select id from educational_institutions where daira_id=$1 limit 1', [dairaMe.json().user.dairaId])).rows[0].id;
    const foreignAssociationInstitution = (await pool!.query('select id from educational_institutions where organization_id<>$1 limit 1', [associationMe.json().user.organizationId])).rows[0].id;
    const foreignDairaInstitution = (await pool!.query('select id from educational_institutions where daira_id<>$1 limit 1', [dairaMe.json().user.dairaId])).rows[0].id;
    const own = await bundle(institutionId, institutionMe.json().user.userId);
    const associationOwn = await bundle(associationOwnInstitution, associationMe.json().user.userId);
    const dairaOwn = await bundle(dairaOwnInstitution, dairaMe.json().user.userId);
    const associationForeign = await bundle(foreignAssociationInstitution, institutionMe.json().user.userId);
    const dairaForeign = await bundle(foreignDairaInstitution, institutionMe.json().user.userId);

    for (const [headers, url] of [[institution, `/api/v1/admin/competition-entries/${own.entry}`], [daira, `/api/v1/admin/competition-results/${dairaOwn.result}`], [association, `/api/v1/admin/qualifications/${associationOwn.qualification}`], [institution, `/api/v1/admin/rankings/${own.ranking}`], [institution, `/api/v1/admin/awards/${own.award}`]] as const) {
      const response = await app!.inject({ method: 'GET', url, headers });
      expect(response.statusCode).toBe(200);
    }

    const foreign = [[institution, `/api/v1/admin/competition-entries/${associationForeign.entry}`], [daira, `/api/v1/admin/competition-results/${dairaForeign.result}`], [association, `/api/v1/admin/qualifications/${associationForeign.qualification}`], [association, `/api/v1/admin/rankings/${associationForeign.ranking}`], [institution, `/api/v1/admin/awards/${associationForeign.award}`]] as const;
    for (const [headers, url] of foreign) {
      const response = await app!.inject({ method: 'GET', url, headers });
      expect(response.statusCode).toBe(403); expect(response.json()).toEqual({ error: 'forbidden' }); noLeak(response);
    }

    const missing = ['/api/v1/admin/competition-entries/00000000-0000-0000-0000-000000000000', '/api/v1/admin/competition-results/00000000-0000-0000-0000-000000000000', '/api/v1/admin/qualifications/00000000-0000-0000-0000-000000000000', '/api/v1/admin/rankings/00000000-0000-0000-0000-000000000000', '/api/v1/admin/awards/00000000-0000-0000-0000-000000000000'];
    for (const url of missing) {
      const response = await app!.inject({ method: 'GET', url, headers: institution });
      expect(response.statusCode).toBe(404); expect(response.json()).toEqual({ error: 'not_found' }); noLeak(response);
    }

    const mutations = [[institution, `/api/v1/admin/competition-entries/${associationForeign.entry}/reject`, 'competition_entries', associationForeign.entry, 'status'], [daira, `/api/v1/admin/competition-results/${dairaForeign.result}/submit`, 'results', dairaForeign.result, 'governed_status'], [association, `/api/v1/admin/qualifications/${associationForeign.qualification}/rejected`, 'qualifications', associationForeign.qualification, 'status'], [association, `/api/v1/admin/rankings/${associationForeign.ranking}/archive`, 'rankings', associationForeign.ranking, 'status'], [institution, `/api/v1/admin/awards/${associationForeign.award}/archive`, 'awards', associationForeign.award, 'status']] as const;
    for (const [headers, url, table, resourceId, statusColumn] of mutations) {
      const before = (await pool!.query(`select ${statusColumn} as status from ${table} where id=$1`, [resourceId])).rows[0].status;
      const response = await app!.inject({ method: 'POST', url, headers });
      expect(response.statusCode).toBe(403); expect(response.json()).toEqual({ error: 'forbidden' }); noLeak(response);
      expect((await pool!.query(`select ${statusColumn} as status from ${table} where id=$1`, [resourceId])).rows[0].status).toBe(before);
      expect((await pool!.query('select count(*)::int as count from audit_logs where entity_id=$1', [resourceId])).rows[0].count).toBe(0);
    }
  });
});
