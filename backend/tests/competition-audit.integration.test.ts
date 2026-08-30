import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import pg from 'pg';
import { buildApp } from '../src/app.js';
import { entries } from '../src/services/competition/entries.js';

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
  const tag = `A5A-${Date.now()}-${sequence++}`;
  const season = (await pool!.query("insert into seasons(name,start_date,end_date) values($1,'2061-01-01','2061-12-31') returning id", [tag])).rows[0].id;
  const programme = (await pool!.query("insert into competition_programmes(season_id,code,title,effective_from) values($1,$2,$2,'2061-01-01') returning id", [season, tag])).rows[0].id;
  const version = (await pool!.query("insert into regulation_versions(version_no,programme_id,effective_period) values('1',$1,'[2061-01-01,2062-01-01)') returning id", [programme])).rows[0].id;
  const competition = (await pool!.query('insert into competitions(season_id,name) values($1,$2) returning id', [season, tag])).rows[0].id;
  const sourceStage = (await pool!.query("insert into competition_stages(competition_id,programme_id,regulation_version_id,stage_level_code) values($1,$2,$3,'W') returning id", [competition, programme, version])).rows[0].id;
  const destinationStage = (await pool!.query("insert into competition_stages(competition_id,parent_stage_id,programme_id,regulation_version_id,stage_level_code) values($1,$2,$3,$4,'D') returning id", [competition, sourceStage, programme, version])).rows[0].id;
  const category = (await pool!.query("insert into categories(programme_id,code,name,gender_code,regulation_version_id) values($1,$2,$2,'OPEN',$3) returning id", [programme, tag, version])).rows[0].id;
  const sport = (await pool!.query("insert into sports(code,name,sport_type) values($1,$1,'INDIVIDUAL') returning id", [tag])).rows[0].id;
  const event = (await pool!.query("insert into events(sport_id,code,name,format) values($1,$2,$2,'INDIVIDUAL') returning id", [sport, tag])).rows[0].id;
  const occurrence = (await pool!.query("insert into calendar_occurrences(stage_id,event_id,category_id,regulation_version_id,start_at) values($1,$2,$3,$4,'2061-02-01') returning id", [sourceStage, event, category, version])).rows[0].id;
  const participant = (await pool!.query("insert into participants(institution_id,given_name) values($1,'Audit') returning id", [institutionId])).rows[0].id;
  const entry = (await pool!.query("insert into competition_entries(stage_id,category_id,institution_id,entry_type,regulation_version_id) values($1,$2,$3,'INDIVIDUAL',$4) returning id", [sourceStage, category, institutionId, version])).rows[0].id;
  const destinationEntry = (await pool!.query("insert into competition_entries(stage_id,category_id,institution_id,entry_type,regulation_version_id) values($1,$2,$3,'INDIVIDUAL',$4) returning id", [destinationStage, category, institutionId, version])).rows[0].id;
  await pool!.query("insert into individual_entries(competition_entry_id,participant_id,stage_id,category_id,participation_state) values($1,$2,$3,$4,'DRAFT'),($5,$2,$6,$4,'DRAFT')", [entry, participant, sourceStage, category, destinationEntry, destinationStage]);
  const result = (await pool!.query("insert into results(competition_id,stage_id,occurrence_id,event_id,category_id,competition_entry_id,regulation_version_id,governed_status,result_data) values($1,$2,$3,$4,$5,$6,$7,'DRAFT','{}') returning id", [competition, sourceStage, occurrence, event, category, entry, version])).rows[0].id;
  await pool!.query("update results set governed_status='SUBMITTED' where id=$1", [result]);
  const validation = (await pool!.query("insert into result_validations(result_id,revision_no,decision,validator_user_id) values($1,0,'VALIDATED',$2) returning id", [result, actorId])).rows[0].id;
  const ranking = (await pool!.query("insert into rankings(stage_id,occurrence_id,event_id,category_id,regulation_version_id,ranking_type,calculation_version,created_by_user_id) values($1,$2,$3,$4,$5,'EVENT',$6,$7) returning id", [sourceStage, occurrence, event, category, version, tag, actorId])).rows[0].id;
  await pool!.query('insert into ranking_inputs(ranking_id,result_id,result_validation_id) values($1,$2,$3)', [ranking, result, validation]);
  await pool!.query('insert into ranking_rows(ranking_id,competition_entry_id,position) values($1,$2,1)', [ranking, entry]);
  const award = (await pool!.query("insert into awards(competition_entry_id,award_type,regulation_version_id) values($1,'MEDAL',$2) returning id", [entry, version])).rows[0].id;
  return { version, sourceStage, destinationStage, category, event, occurrence, entry, destinationEntry, result, ranking, award };
}

async function expectAudit(actorId: string, action: string, entityType: string, entityId: string, metadata?: Record<string, unknown>) {
  const records = (await pool!.query('select actor_user_id,action,entity_type,entity_id,occurred_at,metadata from audit_logs where actor_user_id=$1 and action=$2 and entity_type=$3 and entity_id=$4', [actorId, action, entityType, entityId])).rows;
  expect(records).toHaveLength(1);
  expect(records[0].occurred_at).toBeTruthy();
  if (metadata) expect(records[0].metadata).toMatchObject(metadata);
}

suite('ARCH-014 competition audit integration', () => {
  beforeAll(async () => { await app!.ready(); });
  afterAll(async () => { await app?.close(); await pool?.end(); });

  it('records exactly one authenticated, transactional audit event for each governed domain', async () => {
    const headers = await login();
    const me = await app!.inject({ method: 'GET', url: '/api/v1/auth/me', headers });
    const actorId = me.json().user.userId as string;
    const x = await fixture(me.json().user.institutionId as string, actorId);

    expect((await app!.inject({ method: 'POST', url: `/api/v1/admin/competition-entries/${x.entry}/reject`, headers })).statusCode).toBe(200);
    await expectAudit(actorId, 'REJECTED', 'COMPETITION_ENTRY', x.entry);

    expect((await app!.inject({ method: 'POST', url: `/api/v1/admin/rankings/${x.ranking}/validate`, headers })).statusCode).toBe(200);
    await expectAudit(actorId, 'VALIDATED', 'RANKING', x.ranking);

    expect((await app!.inject({ method: 'POST', url: `/api/v1/admin/competition-results/${x.result}/revisions`, headers, payload: { revisionNo: 1, priorSnapshot: {}, newSnapshot: { score: 1 }, reason: 'audit revision' } })).statusCode).toBe(200);
    await expectAudit(actorId, 'REVISE', 'RESULT', x.result, { revisionNo: 1 });

    const qualification = await app!.inject({ method: 'POST', url: '/api/v1/admin/qualifications', headers, payload: { sourceEntryId: x.entry, sourceStageId: x.sourceStage, destinationStageId: x.destinationStage, destinationEntryId: x.destinationEntry, regulationVersionId: x.version, decisionType: 'MANUAL' } });
    expect(qualification.statusCode).toBe(200);
    const qualificationId = qualification.json().data.id as string;
    expect((await app!.inject({ method: 'POST', url: `/api/v1/admin/qualifications/${qualificationId}/rejected`, headers })).statusCode).toBe(200);
    await expectAudit(actorId, 'REJECTED', 'QUALIFICATION', qualificationId);

    expect((await app!.inject({ method: 'POST', url: `/api/v1/admin/awards/${x.award}/archive`, headers })).statusCode).toBe(200);
    await expectAudit(actorId, 'ARCHIVE', 'AWARD', x.award);

    const rollbackEntry = (await pool!.query("insert into competition_entries(stage_id,category_id,institution_id,entry_type,regulation_version_id) values($1,$2,$3,'INDIVIDUAL',$4) returning id", [x.sourceStage, x.category, me.json().user.institutionId, x.version])).rows[0].id;
    const rollbackParticipant = (await pool!.query("insert into participants(institution_id,given_name) values($1,'Audit Rollback') returning id", [me.json().user.institutionId])).rows[0].id;
    await pool!.query("insert into individual_entries(competition_entry_id,participant_id,stage_id,category_id,participation_state) values($1,$2,$3,$4,'DRAFT')", [rollbackEntry, rollbackParticipant, x.sourceStage, x.category]);
    await expect(entries.transition({ userId: randomUUID() }, rollbackEntry, 'REJECTED')).rejects.toBeTruthy();
    expect((await pool!.query('select status from competition_entries where id=$1', [rollbackEntry])).rows[0].status).toBe('DRAFT');
    expect((await pool!.query("select count(*)::int as count from audit_logs where action='REJECTED' and entity_type='COMPETITION_ENTRY' and entity_id=$1", [rollbackEntry])).rows[0].count).toBe(0);
  });
});
