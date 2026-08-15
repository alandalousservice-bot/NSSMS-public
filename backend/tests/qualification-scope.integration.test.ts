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
  const tag = `A3-${Date.now()}-${sequence++}`;
  const season = (await pool!.query("insert into seasons(name,start_date,end_date) values($1,'2064-01-01','2064-12-31') returning id", [tag])).rows[0].id;
  const programme = (await pool!.query("insert into competition_programmes(season_id,code,title,effective_from) values($1,$2,$2,'2064-01-01') returning id", [season, tag])).rows[0].id;
  const version = (await pool!.query("insert into regulation_versions(version_no,programme_id,effective_period) values('1',$1,'[2064-01-01,2065-01-01)') returning id", [programme])).rows[0].id;
  const competition = (await pool!.query('insert into competitions(season_id,name) values($1,$2) returning id', [season, tag])).rows[0].id;
  const sourceStage = (await pool!.query("insert into competition_stages(competition_id,programme_id,regulation_version_id,stage_level_code) values($1,$2,$3,'W') returning id", [competition, programme, version])).rows[0].id;
  const destinationStage = (await pool!.query("insert into competition_stages(competition_id,parent_stage_id,programme_id,regulation_version_id,stage_level_code) values($1,$2,$3,$4,'D') returning id", [competition, sourceStage, programme, version])).rows[0].id;
  const category = (await pool!.query("insert into categories(programme_id,code,name,gender_code,regulation_version_id) values($1,$2,$2,'OPEN',$3) returning id", [programme, tag, version])).rows[0].id;
  const sport = (await pool!.query("insert into sports(code,name,sport_type) values($1,$1,'INDIVIDUAL') returning id", [tag])).rows[0].id;
  const event = (await pool!.query("insert into events(sport_id,code,name,format) values($1,$2,$2,'INDIVIDUAL') returning id", [sport, tag])).rows[0].id;
  const occurrence = (await pool!.query("insert into calendar_occurrences(stage_id,event_id,category_id,regulation_version_id,start_at) values($1,$2,$3,$4,'2064-02-01') returning id", [sourceStage, event, category, version])).rows[0].id;
  const participant = (await pool!.query("insert into participants(institution_id,given_name) values($1,'Qualification Scope') returning id", [institutionId])).rows[0].id;
  const sourceEntry = (await pool!.query("insert into competition_entries(stage_id,category_id,institution_id,entry_type,regulation_version_id) values($1,$2,$3,'INDIVIDUAL',$4) returning id", [sourceStage, category, institutionId, version])).rows[0].id;
  const destinationEntry = (await pool!.query("insert into competition_entries(stage_id,category_id,institution_id,entry_type,regulation_version_id) values($1,$2,$3,'INDIVIDUAL',$4) returning id", [destinationStage, category, institutionId, version])).rows[0].id;
  await pool!.query("insert into individual_entries(competition_entry_id,participant_id,stage_id,category_id,participation_state) values($1,$2,$3,$4,'DRAFT'),($5,$2,$6,$4,'DRAFT')", [sourceEntry, participant, sourceStage, category, destinationEntry, destinationStage]);
  return { tag, programme, version, competition, sourceStage, destinationStage, category, event, occurrence, sourceEntry, destinationEntry };
}

function qualificationBody(x: Awaited<ReturnType<typeof fixture>>, decisionType: 'RESULT_BASED'|'MANUAL' = 'RESULT_BASED', destinationEntryId: string|undefined = x.destinationEntry) {
  return { sourceEntryId: x.sourceEntry, sourceStageId: x.sourceStage, destinationStageId: x.destinationStage, destinationEntryId, regulationVersionId: x.version, decisionType };
}

async function resultFor(x: Awaited<ReturnType<typeof fixture>>) {
  const result = (await pool!.query("insert into results(competition_id,stage_id,occurrence_id,event_id,category_id,competition_entry_id,regulation_version_id,governed_status,result_data) values($1,$2,$3,$4,$5,$6,$7,'DRAFT','{}') returning id", [x.competition, x.sourceStage, x.occurrence, x.event, x.category, x.sourceEntry, x.version])).rows[0].id;
  await pool!.query("update results set governed_status='SUBMITTED' where id=$1", [result]);
  const validator = (await pool!.query("select id from users where username='demo.admin' and status='ACTIVE'", [])).rows[0].id;
  const validation = (await pool!.query("insert into result_validations(result_id,revision_no,decision,validator_user_id) values($1,0,'VALIDATED',$2) returning id", [result, validator])).rows[0].id;
  return { result, validation };
}

async function expectQualificationRejected(headers: Record<string, string>, body: ReturnType<typeof qualificationBody>, sourceEntryId: string) {
  const response = await app!.inject({ method: 'POST', url: '/api/v1/admin/qualifications', headers, payload: body });
  expect([403, 422]).toContain(response.statusCode); expect(response.json().error).toMatch(/forbidden|invalid_context/);
  expect((await pool!.query('select count(*)::int as count from qualifications where source_entry_id=$1', [sourceEntryId])).rows[0].count).toBe(0);
}

async function expectEvidenceRejected(headers: Record<string, string>, qualificationId: string, resultId: string, validationId: string) {
  const response = await app!.inject({ method: 'POST', url: `/api/v1/admin/qualifications/${qualificationId}/evidence`, headers, payload: { resultId, resultValidationId: validationId } });
  expect([403, 422]).toContain(response.statusCode); expect(response.json().error).toMatch(/forbidden|invalid_context/);
  expect((await pool!.query('select count(*)::int as count from qualification_evidence where qualification_id=$1', [qualificationId])).rows[0].count).toBe(0);
}

suite('governed Qualification scope', () => {
  let institutionA = ''; let institutionB = '';
  beforeAll(async () => {
    await app!.ready();
    const organizations = await pool!.query("select id from organizations where code in ('WILAYA-01','WILAYA-02') order by code");
    institutionA = (await pool!.query('select id from educational_institutions where organization_id=$1 limit 1', [organizations.rows[0].id])).rows[0].id;
    institutionB = (await pool!.query('select id from educational_institutions where organization_id=$1 limit 1', [organizations.rows[1].id])).rows[0].id;
  });
  afterAll(async () => { await app?.close(); await pool?.end(); });

  it('creates own RESULT_BASED and MANUAL draft qualifications and attaches matching evidence', async () => {
    const institution = await login('institution.001.demo', 'NssmsInst-001-2026!'), me = await app!.inject({ method: 'GET', url: '/api/v1/auth/me', headers: institution }), ownInstitution = me.json().user.institutionId as string;
    const resultBased = await fixture(ownInstitution), evidence = await resultFor(resultBased), created = await app!.inject({ method: 'POST', url: '/api/v1/admin/qualifications', headers: institution, payload: qualificationBody(resultBased) });
    expect(created.statusCode).toBe(200); const attached = await app!.inject({ method: 'POST', url: `/api/v1/admin/qualifications/${created.json().data.id}/evidence`, headers: institution, payload: { resultId: evidence.result, resultValidationId: evidence.validation } });
    expect(attached.statusCode).toBe(200);
    const manual = await fixture(ownInstitution), manualCreated = await app!.inject({ method: 'POST', url: '/api/v1/admin/qualifications', headers: institution, payload: qualificationBody(manual, 'MANUAL') });
    expect(manualCreated.statusCode).toBe(200); expect((await pool!.query('select count(*)::int as count from qualification_evidence where qualification_id=$1', [manualCreated.json().data.id])).rows[0].count).toBe(0);
  });

  it('rejects foreign source and destination Entries and foreign Result evidence for an institution user', async () => {
    const institution = await login('institution.001.demo', 'NssmsInst-001-2026!'), me = await app!.inject({ method: 'GET', url: '/api/v1/auth/me', headers: institution }), ownInstitution = me.json().user.institutionId as string;
    const own = await fixture(ownInstitution), foreign = await fixture(institutionB);
    await expectQualificationRejected(institution, qualificationBody(foreign), foreign.sourceEntry);
    await expectQualificationRejected(institution, qualificationBody(own, 'RESULT_BASED', foreign.destinationEntry), own.sourceEntry);
    const created = await app!.inject({ method: 'POST', url: '/api/v1/admin/qualifications', headers: institution, payload: qualificationBody(own) }); expect(created.statusCode).toBe(200);
    const foreignEvidence = await resultFor(foreign);
    await expectEvidenceRejected(institution, created.json().data.id, foreignEvidence.result, foreignEvidence.validation);
  });

  it('isolates association and daira qualification resources', async () => {
    const association = await login('assoc.w01.admin', 'NssmsAssoc-W01-2026!'), daira = await login('daira.001.admin', 'NssmsDaira-001-2026!'), dairaMe = await app!.inject({ method: 'GET', url: '/api/v1/auth/me', headers: daira });
    const associationOwn = await fixture(institutionA), associationForeign = await fixture(institutionB), dairaOwnInstitution = (await pool!.query('select id from educational_institutions where daira_id=$1 limit 1', [dairaMe.json().user.dairaId])).rows[0].id, dairaOwn = await fixture(dairaOwnInstitution), dairaForeignInstitution = (await pool!.query('select id from educational_institutions where daira_id<>$1 limit 1', [dairaMe.json().user.dairaId])).rows[0].id, dairaForeign = await fixture(dairaForeignInstitution);
    await expectQualificationRejected(association, qualificationBody(associationForeign), associationForeign.sourceEntry);
    await expectQualificationRejected(daira, qualificationBody(dairaForeign), dairaForeign.sourceEntry);
    const associationCreated = await app!.inject({ method: 'POST', url: '/api/v1/admin/qualifications', headers: association, payload: qualificationBody(associationOwn) }); expect(associationCreated.statusCode).toBe(200);
    const associationEvidence = await resultFor(associationForeign); await expectEvidenceRejected(association, associationCreated.json().data.id, associationEvidence.result, associationEvidence.validation);
    const dairaCreated = await app!.inject({ method: 'POST', url: '/api/v1/admin/qualifications', headers: daira, payload: qualificationBody(dairaOwn) }); expect(dairaCreated.statusCode).toBe(200);
    const dairaEvidence = await resultFor(dairaForeign); await expectEvidenceRejected(daira, dairaCreated.json().data.id, dairaEvidence.result, dairaEvidence.validation);
  });

  it('rejects source/destination context mismatches and mismatched evidence without partial rows', async () => {
    const institution = await login('institution.001.demo', 'NssmsInst-001-2026!'), me = await app!.inject({ method: 'GET', url: '/api/v1/auth/me', headers: institution }), ownInstitution = me.json().user.institutionId as string;
    const x = await fixture(ownInstitution), unrelatedStage = (await pool!.query("insert into competition_stages(competition_id,programme_id,regulation_version_id,stage_level_code) values($1,$2,$3,'N') returning id", [x.competition, x.programme, x.version])).rows[0].id;
    await expectQualificationRejected(institution, { ...qualificationBody(x), sourceStageId: unrelatedStage }, x.sourceEntry);
    await expectQualificationRejected(institution, { ...qualificationBody(x), destinationStageId: unrelatedStage, destinationEntryId: undefined }, x.sourceEntry);
    const created = await app!.inject({ method: 'POST', url: '/api/v1/admin/qualifications', headers: institution, payload: qualificationBody(x) }); expect(created.statusCode).toBe(200);
    const other = await fixture(ownInstitution), sourceEvidence = await resultFor(x), otherEvidence = await resultFor(other);
    await expectEvidenceRejected(institution, created.json().data.id, otherEvidence.result, otherEvidence.validation);
    await expectEvidenceRejected(institution, created.json().data.id, sourceEvidence.result, otherEvidence.validation);
  });
});
