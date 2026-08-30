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

async function fixture(institutionId: string) {
  const tag = `A17-${Date.now()}-${sequence++}`;
  const season = (await pool!.query("insert into seasons(name,start_date,end_date) values($1,'2078-01-01','2078-12-31') returning id", [tag])).rows[0].id;
  const programme = (await pool!.query("insert into competition_programmes(season_id,code,title,effective_from) values($1,$2,$2,'2078-01-01') returning id", [season, tag])).rows[0].id;
  const version = (await pool!.query("insert into regulation_versions(version_no,programme_id,effective_period) values('1',$1,'[2078-01-01,2079-01-01)') returning id", [programme])).rows[0].id;
  const competition = (await pool!.query('insert into competitions(season_id,name) values($1,$2) returning id', [season, tag])).rows[0].id;
  const sourceStage = (await pool!.query("insert into competition_stages(competition_id,programme_id,regulation_version_id,stage_level_code) values($1,$2,$3,'W') returning id", [competition, programme, version])).rows[0].id;
  const destinationStage = (await pool!.query("insert into competition_stages(competition_id,parent_stage_id,programme_id,regulation_version_id,stage_level_code) values($1,$2,$3,$4,'D') returning id", [competition, sourceStage, programme, version])).rows[0].id;
  const category = (await pool!.query("insert into categories(programme_id,code,name,gender_code,regulation_version_id) values($1,$2,$2,'OPEN',$3) returning id", [programme, tag, version])).rows[0].id;
  const sport = (await pool!.query("insert into sports(code,name,sport_type) values($1,$1,'INDIVIDUAL') returning id", [tag])).rows[0].id;
  const event = (await pool!.query("insert into events(sport_id,code,name,format) values($1,$2,$2,'INDIVIDUAL') returning id", [sport, tag])).rows[0].id;
  const occurrence = (await pool!.query("insert into calendar_occurrences(stage_id,event_id,category_id,regulation_version_id,start_at) values($1,$2,$3,$4,'2078-02-01') returning id", [sourceStage, event, category, version])).rows[0].id;
  const participant = (await pool!.query("insert into participants(institution_id,given_name,family_name) values($1,'Release','Acceptance') returning id", [institutionId])).rows[0].id;
  return { competition, sourceStage, destinationStage, category, event, occurrence, version, participant };
}

suite('ARCH-017 controlled-release competition acceptance', () => {
  beforeAll(async () => { await app!.ready(); });
  afterAll(async () => { await app?.close(); await pool?.end(); });

  it('runs the governed workflow, correction, supersession, audit, and scoped acceptance through protected APIs', async () => {
    const national = await login('demo.admin', 'NssmsDemoAdmin-2026!');
    const institution = await login('institution.001.demo', 'NssmsInst-001-2026!');
    const me = await app!.inject({ method: 'GET', url: '/api/v1/auth/me', headers: institution });
    expect(me.statusCode).toBe(200);
    const actorId = me.json().user.userId as string;
    const x = await fixture(me.json().user.institutionId as string);

    for (const stageId of [x.sourceStage, x.destinationStage]) {
      const grant = await app!.inject({ method: 'POST', url: `/api/v1/admin/competition-stages/${stageId}/eligibility`, headers: national, payload: { scopeType: 'INSTITUTION', institutionId: me.json().user.institutionId } });
      expect(grant.statusCode).toBe(200);
    }
    const references = await app!.inject({ method: 'GET', url: `/api/v1/admin/competition-reference/stages?competition_id=${x.competition}`, headers: institution });
    expect(references.json().data).toContainEqual(expect.objectContaining({ id: x.sourceStage }));

    const entry = await app!.inject({ method: 'POST', url: '/api/v1/admin/competition-entries', headers: institution, payload: { stageId: x.sourceStage, categoryId: x.category, institutionId: me.json().user.institutionId, regulationVersionId: x.version, participantId: x.participant } });
    expect(entry.statusCode).toBe(200); const entryId = entry.json().data.id as string;
    expect((await app!.inject({ method: 'POST', url: `/api/v1/admin/competition-entries/${entryId}/submit`, headers: institution })).statusCode).toBe(200);
    expect((await app!.inject({ method: 'POST', url: `/api/v1/admin/competition-entries/${entryId}/validate`, headers: institution })).statusCode).toBe(200);

    const result = await app!.inject({ method: 'POST', url: '/api/v1/admin/competition-results', headers: institution, payload: { competitionId: x.competition, stageId: x.sourceStage, occurrenceId: x.occurrence, eventId: x.event, categoryId: x.category, competitionEntryId: entryId, regulationVersionId: x.version, resultData: { score: 10 } } });
    expect(result.statusCode).toBe(200); const resultId = result.json().data.id as string;
    expect((await app!.inject({ method: 'POST', url: `/api/v1/admin/competition-results/${resultId}/submit`, headers: institution })).statusCode).toBe(200);
    const v1 = await app!.inject({ method: 'POST', url: `/api/v1/admin/competition-results/${resultId}/validated`, headers: institution, payload: { revisionNo: 0 } });
    expect(v1.statusCode).toBe(200);

    const qualification = await app!.inject({ method: 'POST', url: '/api/v1/admin/qualifications', headers: institution, payload: { sourceEntryId: entryId, sourceStageId: x.sourceStage, destinationStageId: x.destinationStage, regulationVersionId: x.version, decisionType: 'RESULT_BASED' } });
    expect(qualification.statusCode).toBe(200); const qualificationId = qualification.json().data.id as string;
    expect((await app!.inject({ method: 'POST', url: `/api/v1/admin/qualifications/${qualificationId}/evidence`, headers: institution, payload: { resultId, resultValidationId: v1.json().data.id } })).statusCode).toBe(200);
    expect((await app!.inject({ method: 'POST', url: `/api/v1/admin/qualifications/${qualificationId}/approve`, headers: institution })).statusCode).toBe(200);

    const rankingA = await app!.inject({ method: 'POST', url: '/api/v1/admin/rankings', headers: institution, payload: { stageId: x.sourceStage, occurrenceId: x.occurrence, eventId: x.event, categoryId: x.category, regulationVersionId: x.version, rankingType: 'EVENT', calculationVersion: 'acceptance-v1' } });
    expect(rankingA.statusCode).toBe(200); const rankingAId = rankingA.json().data.id as string;
    expect((await app!.inject({ method: 'POST', url: `/api/v1/admin/rankings/${rankingAId}/inputs`, headers: institution, payload: { resultId, resultValidationId: v1.json().data.id } })).statusCode).toBe(200);
    expect((await app!.inject({ method: 'POST', url: `/api/v1/admin/rankings/${rankingAId}/rows`, headers: institution, payload: { competitionEntryId: entryId, position: 1 } })).statusCode).toBe(200);
    expect((await app!.inject({ method: 'POST', url: `/api/v1/admin/rankings/${rankingAId}/validate`, headers: institution })).statusCode).toBe(200);
    expect((await app!.inject({ method: 'POST', url: `/api/v1/admin/rankings/${rankingAId}/publish`, headers: institution })).statusCode).toBe(200);

    const award = await app!.inject({ method: 'POST', url: '/api/v1/admin/awards', headers: institution, payload: { rankingId: rankingAId, competitionEntryId: entryId, awardType: 'MEDAL', regulationVersionId: x.version } });
    expect(award.statusCode).toBe(200); const awardId = award.json().data.id as string;
    expect((await app!.inject({ method: 'POST', url: `/api/v1/admin/awards/${awardId}/issue`, headers: institution })).statusCode).toBe(200);
    expect((await app!.inject({ method: 'POST', url: `/api/v1/admin/awards/${awardId}/revoke`, headers: institution })).statusCode).toBe(200);
    const archivedAward = await app!.inject({ method: 'POST', url: `/api/v1/admin/awards/${awardId}/archive`, headers: institution });
    expect(archivedAward.statusCode).toBe(200); expect(archivedAward.json().data).toEqual(expect.objectContaining({ status: 'ARCHIVED', issued_by_user_id: actorId, revoked_by_user_id: actorId, issued_at: expect.any(String), revoked_at: expect.any(String), archived_at: expect.any(String) }));

    const revision = await app!.inject({ method: 'POST', url: `/api/v1/admin/competition-results/${resultId}/revisions`, headers: institution, payload: { revisionNo: 1, priorSnapshot: { score: 10 }, newSnapshot: { score: 11 }, reason: 'Acceptance correction' } });
    expect(revision.statusCode).toBe(200);
    const v2 = await app!.inject({ method: 'POST', url: `/api/v1/admin/competition-results/${resultId}/validated`, headers: institution, payload: { revisionNo: 1, supersedesValidationId: v1.json().data.id } });
    expect(v2.statusCode).toBe(200);
    const corrected = await app!.inject({ method: 'GET', url: `/api/v1/admin/competition-results/${resultId}`, headers: institution });
    expect(corrected.json().data).toEqual(expect.objectContaining({ official_payload: { score: 11 }, current_validation: expect.objectContaining({ id: v2.json().data.id, revision_no: 1 }) }));
    const staleRanking = await app!.inject({ method: 'POST', url: '/api/v1/admin/rankings', headers: institution, payload: { stageId: x.sourceStage, occurrenceId: x.occurrence, eventId: x.event, categoryId: x.category, regulationVersionId: x.version, rankingType: 'EVENT', calculationVersion: 'stale-check' } });
    const staleInput = await app!.inject({ method: 'POST', url: `/api/v1/admin/rankings/${staleRanking.json().data.id}/inputs`, headers: institution, payload: { resultId, resultValidationId: v1.json().data.id } });
    expect(staleInput.statusCode).toBe(409); expect(staleInput.json().error).toBe('invalid_state');

    const rankingB = await app!.inject({ method: 'POST', url: '/api/v1/admin/rankings', headers: institution, payload: { stageId: x.sourceStage, occurrenceId: x.occurrence, eventId: x.event, categoryId: x.category, regulationVersionId: x.version, rankingType: 'EVENT', calculationVersion: 'acceptance-v2', supersedesRankingId: rankingAId } });
    expect(rankingB.statusCode).toBe(200); const rankingBId = rankingB.json().data.id as string;
    const currentA = await app!.inject({ method: 'GET', url: `/api/v1/admin/rankings/current?stageId=${x.sourceStage}&eventId=${x.event}&categoryId=${x.category}&rankingType=EVENT`, headers: institution });
    expect(currentA.json().data.id).toBe(rankingAId);
    for (const request of [
      { url: `/api/v1/admin/rankings/${rankingBId}/inputs`, payload: { resultId, resultValidationId: v2.json().data.id } },
      { url: `/api/v1/admin/rankings/${rankingBId}/rows`, payload: { competitionEntryId: entryId, position: 1 } }
    ]) expect((await app!.inject({ method: 'POST', url: request.url, headers: institution, payload: request.payload })).statusCode).toBe(200);
    expect((await app!.inject({ method: 'POST', url: `/api/v1/admin/rankings/${rankingBId}/validate`, headers: institution })).statusCode).toBe(200);
    expect((await app!.inject({ method: 'POST', url: `/api/v1/admin/rankings/${rankingBId}/publish`, headers: institution })).statusCode).toBe(200);
    expect((await app!.inject({ method: 'GET', url: `/api/v1/admin/rankings/current?stageId=${x.sourceStage}&eventId=${x.event}&categoryId=${x.category}&rankingType=EVENT`, headers: institution })).json().data.id).toBe(rankingBId);
    expect((await app!.inject({ method: 'POST', url: `/api/v1/admin/rankings/${rankingBId}/archive`, headers: institution })).statusCode).toBe(200);
    expect((await app!.inject({ method: 'GET', url: `/api/v1/admin/rankings/current?stageId=${x.sourceStage}&eventId=${x.event}&categoryId=${x.category}&rankingType=EVENT`, headers: institution })).json().data).toBeNull();

    const audit = await pool!.query("select action,entity_type,entity_id,actor_user_id,occurred_at from audit_logs where actor_user_id=$1 and entity_id = any($2::uuid[])", [actorId, [entryId, resultId, qualificationId, rankingAId, rankingBId, awardId]]);
    expect(audit.rows.every(row => row.actor_user_id === actorId && row.occurred_at)).toBe(true);
    expect(audit.rows.map(row => `${row.entity_type}:${row.action}`)).toEqual(expect.arrayContaining(['COMPETITION_ENTRY:VALIDATED', 'RESULT:VALIDATED', 'RESULT:REVISE', 'QUALIFICATION:APPROVED', 'RANKING:PUBLISHED', 'RANKING:ARCHIVED', 'AWARD:ISSUE', 'AWARD:REVOKE', 'AWARD:ARCHIVE']));
  });
});
