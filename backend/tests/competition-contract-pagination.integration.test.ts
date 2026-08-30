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
  const tag = `A2C-${Date.now()}-${sequence++}`;
  const season = (await pool!.query("insert into seasons(name,start_date,end_date) values($1,'2066-01-01','2066-12-31') returning id", [tag])).rows[0].id;
  const programme = (await pool!.query("insert into competition_programmes(season_id,code,title,effective_from) values($1,$2,$2,'2066-01-01') returning id", [season, tag])).rows[0].id;
  const version = (await pool!.query("insert into regulation_versions(version_no,programme_id,effective_period) values('1',$1,'[2066-01-01,2067-01-01)') returning id", [programme])).rows[0].id;
  const competition = (await pool!.query('insert into competitions(season_id,name) values($1,$2) returning id', [season, tag])).rows[0].id;
  const stage = (await pool!.query("insert into competition_stages(competition_id,programme_id,regulation_version_id,stage_level_code) values($1,$2,$3,'W') returning id", [competition, programme, version])).rows[0].id;
  const category = (await pool!.query("insert into categories(programme_id,code,name,gender_code,regulation_version_id) values($1,$2,$2,'OPEN',$3) returning id", [programme, tag, version])).rows[0].id;
  const sport = (await pool!.query("insert into sports(code,name,sport_type) values($1,$1,'INDIVIDUAL') returning id", [tag])).rows[0].id;
  const event = (await pool!.query("insert into events(sport_id,code,name,format) values($1,$2,$2,'INDIVIDUAL') returning id", [sport, tag])).rows[0].id;
  const occurrence = (await pool!.query("insert into calendar_occurrences(stage_id,event_id,category_id,regulation_version_id,start_at) values($1,$2,$3,$4,'2066-02-01') returning id", [stage, event, category, version])).rows[0].id;
  const participant = (await pool!.query("insert into participants(institution_id,given_name) values($1,'Contract') returning id", [institutionId])).rows[0].id;
  const entry = (await pool!.query("insert into competition_entries(stage_id,category_id,institution_id,entry_type,regulation_version_id) values($1,$2,$3,'INDIVIDUAL',$4) returning id", [stage, category, institutionId, version])).rows[0].id;
  await pool!.query("insert into individual_entries(competition_entry_id,participant_id,stage_id,category_id,participation_state) values($1,$2,$3,$4,'DRAFT')", [entry, participant, stage, category]);
  const result = (await pool!.query("insert into results(competition_id,stage_id,occurrence_id,event_id,category_id,competition_entry_id,regulation_version_id,governed_status,result_data) values($1,$2,$3,$4,$5,$6,$7,'DRAFT',$8) returning id", [competition, stage, occurrence, event, category, entry, version, { score: 7 }])).rows[0].id;
  const ranking = (await pool!.query("insert into rankings(stage_id,occurrence_id,event_id,category_id,regulation_version_id,ranking_type,calculation_version,created_by_user_id) values($1,$2,$3,$4,$5,'EVENT','contract',$6) returning id", [stage, occurrence, event, category, version, actorId])).rows[0].id;
  const award = (await pool!.query("insert into awards(ranking_id,competition_entry_id,award_type,regulation_version_id) values($1,$2,'MEDAL',$3) returning id", [ranking, entry, version])).rows[0].id;
  return { entry, result, ranking, award, stage, category, event, occurrence, version };
}

suite('ARCH-015 A2 competition response contracts and pagination', () => {
  beforeAll(async () => { await app!.ready(); });
  afterAll(async () => { await app?.close(); await pool?.end(); });

  it('returns DTO envelopes, deterministic pagination, and scoped collections', async () => {
    const headers = await login();
    const me = await app!.inject({ method: 'GET', url: '/api/v1/auth/me', headers });
    const own = await fixture(me.json().user.institutionId, me.json().user.id ?? me.json().user.userId);
    const foreignInstitution = (await pool!.query('select id from educational_institutions where id<>$1 limit 1', [me.json().user.institutionId])).rows[0].id;
    const foreign = await fixture(foreignInstitution, me.json().user.id ?? me.json().user.userId);
    const entries = await app!.inject({ method: 'GET', url: `/api/v1/admin/competition-entries?limit=1&offset=0&institution_id=${me.json().user.institutionId}&stage_id=${own.stage}`, headers });
    expect(entries.statusCode).toBe(200); expect(entries.json().meta.pagination).toEqual({ limit: 1, offset: 0, total: 1 });
    expect(entries.json().data).toEqual([expect.objectContaining({ id: own.entry, institution_id: me.json().user.institutionId, created_at: expect.any(String) })]);
    for (const [url, id] of [[`/api/v1/admin/qualifications?limit=1`, undefined], [`/api/v1/admin/rankings?limit=1&stage_id=${own.stage}`, own.ranking], [`/api/v1/admin/awards?limit=1&ranking_id=${own.ranking}`, own.award]] as const) {
      const response = await app!.inject({ method: 'GET', url, headers });
      expect(response.statusCode).toBe(200); expect(response.json().data).toEqual(expect.any(Array)); expect(response.json().meta.pagination).toEqual(expect.objectContaining({ limit: 1, offset: 0 }));
      if (id) expect(response.json().data[0]).toEqual(expect.objectContaining({ id }));
      expect(response.json().data.some((row: { id: string }) => row.id === foreign.entry || row.id === foreign.ranking || row.id === foreign.award)).toBe(false);
    }
  });

  it('uses explicit result payload semantics and rejects invalid pagination safely', async () => {
    const headers = await login(); const me = await app!.inject({ method: 'GET', url: '/api/v1/auth/me', headers }); const own = await fixture(me.json().user.institutionId, me.json().user.id ?? me.json().user.userId);
    const result = await app!.inject({ method: 'GET', url: `/api/v1/admin/competition-results/${own.result}`, headers });
    expect(result.statusCode).toBe(200); expect(result.json()).toEqual({ data: expect.objectContaining({ id: own.result, base_payload: { score: 7 }, official_payload: null, current_authoritative_decision: null, legacy_unresolved: false }) }); expect(result.body).not.toContain('result_data');
    const history = await app!.inject({ method: 'GET', url: `/api/v1/admin/competition-results/${own.result}/history?limit=1&offset=0`, headers });
    expect(history.statusCode).toBe(200); expect(history.json().meta.pagination).toEqual({ limit: 1, offset: 0, total: 0 });
    for (const url of ['/api/v1/admin/competition-entries?limit=-1', '/api/v1/admin/awards?ranking_id=bad-uuid']) { const response = await app!.inject({ method: 'GET', url, headers }); expect(response.statusCode).toBe(422); expect(response.json()).toEqual({ error: 'validation_error' }); expect(response.body).not.toMatch(/postgres|sql|constraint|trigger|stack|driver/i); }
  });

  it('keeps association and daira collection filters inside the authorized hierarchy', async () => {
    const association = await app!.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { username: 'assoc.w01.admin', password: 'NssmsAssoc-W01-2026!' } }); expect(association.statusCode).toBe(200); const associationHeaders = { authorization: `Bearer ${association.json().token}` };
    const associationMe = await app!.inject({ method: 'GET', url: '/api/v1/auth/me', headers: associationHeaders }); const associationOwn = (await pool!.query('select id from educational_institutions where organization_id=$1 limit 1', [associationMe.json().user.organizationId])).rows[0].id; const associationForeign = (await pool!.query('select id from educational_institutions where organization_id<>$1 limit 1', [associationMe.json().user.organizationId])).rows[0].id;
    const ownAssociationEntry = await fixture(associationOwn, associationMe.json().user.id ?? associationMe.json().user.userId); const foreignAssociationEntry = await fixture(associationForeign, associationMe.json().user.id ?? associationMe.json().user.userId);
    const associationList = await app!.inject({ method: 'GET', url: `/api/v1/admin/competition-entries?stage_id=${ownAssociationEntry.stage}`, headers: associationHeaders }); expect(associationList.statusCode).toBe(200); expect(associationList.json().data).toEqual([expect.objectContaining({ id: ownAssociationEntry.entry })]); expect(associationList.json().data.some((row: { id: string }) => row.id === foreignAssociationEntry.entry)).toBe(false);
    const daira = await app!.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { username: 'daira.001.admin', password: 'NssmsDaira-001-2026!' } }); expect(daira.statusCode).toBe(200); const dairaHeaders = { authorization: `Bearer ${daira.json().token}` };
    const dairaMe = await app!.inject({ method: 'GET', url: '/api/v1/auth/me', headers: dairaHeaders }); const dairaOwn = (await pool!.query('select id from educational_institutions where daira_id=$1 limit 1', [dairaMe.json().user.dairaId])).rows[0].id; const dairaForeign = (await pool!.query('select id from educational_institutions where daira_id<>$1 limit 1', [dairaMe.json().user.dairaId])).rows[0].id;
    const ownDairaEntry = await fixture(dairaOwn, dairaMe.json().user.id ?? dairaMe.json().user.userId); const foreignDairaEntry = await fixture(dairaForeign, dairaMe.json().user.id ?? dairaMe.json().user.userId);
    const dairaList = await app!.inject({ method: 'GET', url: `/api/v1/admin/competition-entries?stage_id=${ownDairaEntry.stage}`, headers: dairaHeaders }); expect(dairaList.statusCode).toBe(200); expect(dairaList.json().data).toEqual([expect.objectContaining({ id: ownDairaEntry.entry })]); expect(dairaList.json().data.some((row: { id: string }) => row.id === foreignDairaEntry.entry)).toBe(false);
  });

  it('exposes current Ranking from the approved supersession resolver', async () => {
    const headers = await login(); const me = await app!.inject({ method: 'GET', url: '/api/v1/auth/me', headers }); const own = await fixture(me.json().user.institutionId, me.json().user.id ?? me.json().user.userId);
    expect((await app!.inject({ method: 'POST', url: `/api/v1/admin/competition-results/${own.result}/submit`, headers })).statusCode).toBe(200);
    const validation = await app!.inject({ method: 'POST', url: `/api/v1/admin/competition-results/${own.result}/validated`, headers, payload: { revisionNo: 0 } }); expect(validation.statusCode).toBe(200);
    const rankingBody = { stageId: own.stage, occurrenceId: own.occurrence, eventId: own.event, categoryId: own.category, regulationVersionId: own.version, rankingType: 'EVENT', calculationVersion: 'contract-current' };
    const createOfficial = async (supersedesRankingId?: string) => {
      const created = await app!.inject({ method: 'POST', url: '/api/v1/admin/rankings', headers, payload: { ...rankingBody, supersedesRankingId } }); expect(created.statusCode).toBe(200); const rankingId = created.json().data.id as string;
      expect((await app!.inject({ method: 'POST', url: `/api/v1/admin/rankings/${rankingId}/inputs`, headers, payload: { resultId: own.result, resultValidationId: validation.json().data.id } })).statusCode).toBe(200);
      expect((await app!.inject({ method: 'POST', url: `/api/v1/admin/rankings/${rankingId}/rows`, headers, payload: { competitionEntryId: own.entry, position: 1 } })).statusCode).toBe(200);
      expect((await app!.inject({ method: 'POST', url: `/api/v1/admin/rankings/${rankingId}/validate`, headers })).statusCode).toBe(200); return rankingId;
    };
    const a = await createOfficial();
    const currentUrl = `/api/v1/admin/rankings/current?stageId=${own.stage}&eventId=${own.event}&categoryId=${own.category}&rankingType=EVENT`;
    expect((await app!.inject({ method: 'GET', url: currentUrl, headers })).json().data).toEqual(expect.objectContaining({ id: a, current: true }));
    const bDraft = await app!.inject({ method: 'POST', url: '/api/v1/admin/rankings', headers, payload: { ...rankingBody, supersedesRankingId: a } }); expect(bDraft.statusCode).toBe(200); const b = bDraft.json().data.id as string;
    expect((await app!.inject({ method: 'GET', url: currentUrl, headers })).json().data).toEqual(expect.objectContaining({ id: a, current: true }));
    for (const response of [await app!.inject({ method: 'POST', url: `/api/v1/admin/rankings/${b}/inputs`, headers, payload: { resultId: own.result, resultValidationId: validation.json().data.id } }), await app!.inject({ method: 'POST', url: `/api/v1/admin/rankings/${b}/rows`, headers, payload: { competitionEntryId: own.entry, position: 1 } }), await app!.inject({ method: 'POST', url: `/api/v1/admin/rankings/${b}/validate`, headers })]) expect(response.statusCode).toBe(200);
    expect((await app!.inject({ method: 'GET', url: currentUrl, headers })).json().data).toEqual(expect.objectContaining({ id: b, current: true }));
    expect((await app!.inject({ method: 'POST', url: `/api/v1/admin/rankings/${b}/archive`, headers })).statusCode).toBe(200);
    expect((await app!.inject({ method: 'GET', url: currentUrl, headers })).json().data).toBeNull();
  });
});
