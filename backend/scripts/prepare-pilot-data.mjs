import pg from 'pg';
import { buildApp } from '../src/app.js';

const databaseUrl = process.env.DATABASE_URL ?? '';
const parsed = new URL(databaseUrl);
if (process.env.PILOT_DATA !== 'true') throw new Error('PILOT_DATA=true is required');
if (process.env.NODE_ENV === 'production') throw new Error('Pilot data is forbidden in production');
if (parsed.hostname !== 'localhost' || parsed.port !== '55433' || parsed.pathname !== '/nssms_pilot_local') {
  throw new Error('Pilot data requires localhost:55433/nssms_pilot_local');
}
if (!process.env.AUTH_SECRET) throw new Error('AUTH_SECRET is required');
const requiredPasswords = {
  PILOT_ADMIN_PASSWORD: process.env.PILOT_ADMIN_PASSWORD,
  PILOT_INSTITUTION_PASSWORD: process.env.PILOT_INSTITUTION_PASSWORD
};
for (const [name, value] of Object.entries(requiredPasswords)) {
  if (!value || value.length < 12) throw new Error(`${name} is required and must be at least 12 characters`);
}

const pool = new pg.Pool({ connectionString: databaseUrl });
const app = buildApp();
const name = 'منافسة تجريبية محلية - UAT';

const fail = (label, response) => {
  if (response.statusCode < 200 || response.statusCode >= 300) throw new Error(`${label} failed with HTTP ${response.statusCode}: ${response.body}`);
  return response.json().data;
};
const login = async (username, password) => {
  const response = await app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { username, password } });
  if (response.statusCode !== 200) throw new Error(`Login failed for ${username}`);
  return { authorization: `Bearer ${response.json().token}` };
};
const queryOne = async (sql, values = []) => (await pool.query(sql, values)).rows[0];
const api = (method, url, headers, payload) => app.inject({ method, url, headers, ...(payload === undefined ? {} : { payload }) });
const transition = async (headers, url, current, target) => {
  if (current === target) return current;
  return fail(`transition ${url}`, await api('POST', url, headers, { to: target }));
};
const entryTransition = async (headers, id, current, target) => {
  const actual = (await queryOne('select status from competition_entries where id=$1', [id])).status;
  if (actual === target || (target === 'SUBMITTED' && actual === 'VALIDATED') || (target === 'VALIDATED' && actual === 'VALIDATED')) return;
  const path = target === 'SUBMITTED' ? 'submit' : target === 'VALIDATED' ? 'validate' : target.toLowerCase();
  fail(`entry ${target}`, await api('POST', `/api/v1/admin/competition-entries/${id}/${path}`, headers));
};

try {
  await app.ready();
  const national = await login('demo.admin', requiredPasswords.PILOT_ADMIN_PASSWORD);
  const institutionHeaders = await login('demo.institution', requiredPasswords.PILOT_INSTITUTION_PASSWORD);
  const me = (await api('GET', '/api/v1/auth/me', institutionHeaders)).json().user;
  const institutionId = me.institutionId;
  const organizationId = me.organizationId;
  const season = await queryOne("select id from seasons where name='الموسم التجريبي 2025-2026' and archived_at is null order by created_at limit 1");
  const institution = await queryOne('select id from educational_institutions where id=$1 and archived_at is null', [institutionId]);
  if (!season || !institution) throw new Error('Expected existing pilot season/institution was not found');

  let competition = await queryOne('select id,status from competitions where name=$1 and archived_at is null', [name]);
  if (competition) {
    console.log(`Pilot competition already exists: ${competition.id}`);
  } else {
    competition = fail('competition create', await api('POST', '/api/v1/admin/competitions', national, {
      seasonId: season.id, name, startDate: '2026-02-01', endDate: '2026-02-03'
    }));
  }

  const programme = await queryOne("insert into competition_programmes(season_id,code,title,effective_from) values($1,'PILOT-UAT-2026','برنامج تجريبي محلي UAT','2026-01-01') on conflict do nothing returning id", [season.id])
    ?? await queryOne("select id from competition_programmes where season_id=$1 and code='PILOT-UAT-2026'", [season.id]);
  const version = await queryOne("insert into regulation_versions(version_no,programme_id,effective_period) values('PILOT-UAT-1',$1,'[2026-01-01,2027-01-01)') on conflict do nothing returning id", [programme.id])
    ?? await queryOne("select id from regulation_versions where programme_id=$1 and version_no='PILOT-UAT-1'", [programme.id]);
  const category = await queryOne("insert into categories(programme_id,code,name,gender_code,regulation_version_id) values($1,'PILOT-OPEN','فئة تجريبية مفتوحة','OPEN',$2) on conflict do nothing returning id", [programme.id, version.id])
    ?? await queryOne("select id from categories where programme_id=$1 and code='PILOT-OPEN'", [programme.id]);
  const sport = await queryOne("insert into sports(code,name,sport_type) values('PILOT-ATHLETICS','رياضة تجريبية','INDIVIDUAL') on conflict do nothing returning id")
    ?? await queryOne("select id from sports where code='PILOT-ATHLETICS'");
  const event = await queryOne("insert into events(sport_id,code,name,format) values($1,'PILOT-100M','سباق تجريبي 100م','INDIVIDUAL') on conflict do nothing returning id", [sport.id])
    ?? await queryOne("select id from events where sport_id=$1 and code='PILOT-100M'", [sport.id]);
  const sourceStage = await queryOne("select id from competition_stages where competition_id=$1 and stage_level_code='W' order by created_at limit 1", [competition.id])
    ?? await queryOne("insert into competition_stages(competition_id,programme_id,regulation_version_id,stage_level_code,start_date,end_date) values($1,$2,$3,'W','2026-02-01','2026-02-02') returning id", [competition.id, programme.id, version.id]);
  const destinationStage = await queryOne("select id from competition_stages where competition_id=$1 and parent_stage_id=$2", [competition.id, sourceStage.id])
    ?? await queryOne("insert into competition_stages(competition_id,parent_stage_id,programme_id,regulation_version_id,stage_level_code,start_date,end_date) values($1,$2,$3,$4,'D','2026-02-02','2026-02-03') returning id", [competition.id, sourceStage.id, programme.id, version.id]);
  const occurrence = await queryOne('select id from calendar_occurrences where stage_id=$1 and event_id=$2 and category_id=$3', [sourceStage.id, event.id, category.id])
    ?? await queryOne("insert into calendar_occurrences(stage_id,event_id,category_id,regulation_version_id,start_at) values($1,$2,$3,$4,'2026-02-01') returning id", [sourceStage.id, event.id, category.id, version.id]);

  for (const stage of [sourceStage, destinationStage]) {
    const existing = await api('GET', `/api/v1/admin/competition-stages/${stage.id}/eligibility`, national);
    if (!existing.json().data.some((row) => row.institution_id === institutionId || row.institutionId === institutionId)) {
      fail('stage eligibility', await api('POST', `/api/v1/admin/competition-stages/${stage.id}/eligibility`, national, { scopeType: 'INSTITUTION', institutionId }));
    }
  }
  const participants = [];
  for (const [given, family] of [['UAT فردي 01', 'تجريبي'], ['UAT فردي 02', 'تجريبي'], ['UAT فريق 01', 'تجريبي'], ['UAT فريق 02', 'تجريبي']]) {
    participants.push((await queryOne('select id from participants where institution_id=$1 and given_name=$2 and family_name=$3', [institutionId, given, family])) ?? await queryOne('insert into participants(institution_id,given_name,family_name) values($1,$2,$3) returning id', [institutionId, given, family]));
  }
  const team = await queryOne("select id from teams where institution_id=$1 and name='فريق UAT التجريبي'", [institutionId]) ?? await queryOne("insert into teams(institution_id,category_id,stage_id,name) values($1,$2,$3,'فريق UAT التجريبي') returning id", [institutionId, category.id, sourceStage.id]);
  const team2 = await queryOne("select id from teams where institution_id=$1 and name='فريق UAT التجريبي 02'", [institutionId]) ?? await queryOne("insert into teams(institution_id,category_id,stage_id,name) values($1,$2,$3,'فريق UAT التجريبي 02') returning id", [institutionId, category.id, sourceStage.id]);
  for (const selectedTeam of [team, team2]) for (const participant of participants.slice(2)) await pool.query("insert into team_members(team_id,participant_id,role) select $1,$2,'ATHLETE' where not exists (select 1 from team_members where team_id=$1 and participant_id=$2 and valid_to is null)", [selectedTeam.id, participant.id]);

  const makeEntry = async (participantId, teamId, stageId = sourceStage.id) => {
    const existing = teamId ? await queryOne('select ce.id,ce.status from competition_entries ce join team_entries te on te.competition_entry_id=ce.id where ce.stage_id=$1 and te.team_id=$2', [stageId, teamId]) : await queryOne('select ce.id,ce.status from competition_entries ce join individual_entries ie on ie.competition_entry_id=ce.id where ce.stage_id=$1 and ie.participant_id=$2', [stageId, participantId]);
    if (existing) return existing;
    const body = { stageId, categoryId: category.id, institutionId, regulationVersionId: version.id, ...(teamId ? { teamId } : { participantId }) };
    return fail('entry create', await api('POST', '/api/v1/admin/competition-entries', institutionHeaders, body));
  };
  const entry1 = await makeEntry(participants[0].id);
  const entry2 = await makeEntry(participants[1].id);
  const teamEntry = await makeEntry(undefined, team.id);
  const teamEntry2 = await makeEntry(undefined, team2.id);
  const destinationEntry = await makeEntry(participants[0].id, undefined, destinationStage.id);

  const competitionStates = ['DRAFT', 'REVIEW', 'APPROVED', 'REGISTRATION', 'ACTIVE', 'RESULTS'];
  for (const target of competitionStates.slice(1)) {
    const current = await queryOne('select status from competitions where id=$1', [competition.id]);
    if (competitionStates.indexOf(current.status) >= competitionStates.indexOf(target)) continue;
    const previous = competitionStates[competitionStates.indexOf(target) - 1];
    if (current.status === previous) await transition(national, `/api/v1/admin/competitions/${competition.id}/transition`, previous, target);
  }
  await entryTransition(institutionHeaders, entry1.id, entry1.status, 'SUBMITTED'); await entryTransition(institutionHeaders, entry1.id, 'SUBMITTED', 'VALIDATED');
  await entryTransition(institutionHeaders, entry2.id, entry2.status, 'SUBMITTED');
  await entryTransition(institutionHeaders, teamEntry.id, teamEntry.status, 'SUBMITTED');

  const resultFor = async (entry, score) => {
    const existing = await queryOne('select id,governed_status from results where competition_entry_id=$1 and archived_at is null', [entry.id]);
    if (existing) return existing;
    return fail('result create', await api('POST', '/api/v1/admin/competition-results', institutionHeaders, { competitionId: competition.id, stageId: sourceStage.id, occurrenceId: occurrence.id, eventId: event.id, categoryId: category.id, competitionEntryId: entry.id, regulationVersionId: version.id, resultData: { score, demo: true } }));
  };
  const result1 = await resultFor(entry1, 10); const result2 = await resultFor(entry2, 9); const teamResult = await resultFor(teamEntry, 8);
  const submitAndValidate = async (result, revisionNo = 0, supersedesValidationId) => {
    const current = await queryOne('select governed_status from results where id=$1', [result.id]);
    if (current.governed_status === 'DRAFT') fail('result submit', await api('POST', `/api/v1/admin/competition-results/${result.id}/submit`, institutionHeaders));
    const validation = await queryOne('select id from result_validations where result_id=$1 and revision_no=$2 and decision=$3 and supersedes_validation_id is not distinct from $4', [result.id, revisionNo, 'VALIDATED', supersedesValidationId ?? null]);
    return validation ?? fail('result validate', await api('POST', `/api/v1/admin/competition-results/${result.id}/validated`, institutionHeaders, { revisionNo, ...(supersedesValidationId ? { supersedesValidationId } : {}) }));
  };
  const v1 = await submitAndValidate(result1); const vTeam = await submitAndValidate(teamResult);
  let revision = await queryOne('select id from result_revisions where result_id=$1 and revision_no=1', [result1.id]);
  if (!revision) revision = fail('result revision', await api('POST', `/api/v1/admin/competition-results/${result1.id}/revisions`, institutionHeaders, { revisionNo: 1, priorSnapshot: { score: 10, demo: true }, newSnapshot: { score: 11, demo: true }, reason: 'تصحيح تجريبي UAT' }));
  const v2 = await submitAndValidate(result1, 1, v1.id);
  let qualification = await queryOne('select id,status from qualifications where source_entry_id=$1 and destination_stage_id=$2', [entry1.id, destinationStage.id]);
  if (!qualification) qualification = fail('qualification create', await api('POST', '/api/v1/admin/qualifications', institutionHeaders, { sourceEntryId: entry1.id, sourceStageId: sourceStage.id, destinationStageId: destinationStage.id, destinationEntryId: destinationEntry.id, regulationVersionId: version.id, decisionType: 'RESULT_BASED', reason: 'تأهل تجريبي موثق' }));
  if (qualification.status === 'DRAFT') { const ev = fail('qualification evidence', await api('POST', `/api/v1/admin/qualifications/${qualification.id}/evidence`, institutionHeaders, { resultId: result1.id, resultValidationId: v2.id })); fail('qualification approve', await api('POST', `/api/v1/admin/qualifications/${qualification.id}/approve`, institutionHeaders)); }
  const rankBody = { stageId: sourceStage.id, occurrenceId: occurrence.id, eventId: event.id, categoryId: category.id, regulationVersionId: version.id, rankingType: 'EVENT', calculationVersion: 'pilot-uat-v1', calculationMetadata: { demo: true } };
  let ranking = await queryOne("select id,status from rankings where calculation_version='pilot-uat-v1' and archived_at is null");
  if (!ranking) ranking = fail('ranking create', await api('POST', '/api/v1/admin/rankings', institutionHeaders, rankBody));
  const ensureInput = async (result, validation) => { if (!(await queryOne('select id from ranking_inputs where ranking_id=$1 and result_id=$2', [ranking.id, result.id]))) fail('ranking input', await api('POST', `/api/v1/admin/rankings/${ranking.id}/inputs`, institutionHeaders, { resultId: result.id, resultValidationId: validation.id })); };
  await ensureInput(result1, v2); await ensureInput(teamResult, vTeam);
  if (!(await queryOne('select id from ranking_rows where ranking_id=$1 and competition_entry_id=$2', [ranking.id, entry1.id]))) fail('ranking row', await api('POST', `/api/v1/admin/rankings/${ranking.id}/rows`, institutionHeaders, { competitionEntryId: entry1.id, position: 1, points: 10 }));
  if (!(await queryOne('select id from ranking_rows where ranking_id=$1 and competition_entry_id=$2', [ranking.id, teamEntry.id]))) fail('ranking row', await api('POST', `/api/v1/admin/rankings/${ranking.id}/rows`, institutionHeaders, { competitionEntryId: teamEntry.id, position: 2, points: 8 }));
  if (ranking.status === 'DRAFT') { fail('ranking validate', await api('POST', `/api/v1/admin/rankings/${ranking.id}/validate`, institutionHeaders)); fail('ranking publish', await api('POST', `/api/v1/admin/rankings/${ranking.id}/publish`, institutionHeaders)); }
  const award = await queryOne('select id,status from awards where ranking_id=$1 and competition_entry_id=$2', [ranking.id, entry1.id]) ?? fail('award create', await api('POST', '/api/v1/admin/awards', institutionHeaders, { rankingId: ranking.id, competitionEntryId: entry1.id, awardType: 'MEDAL', label: 'ميدالية تجريبية UAT', regulationVersionId: version.id }));
  if (award.status === 'DRAFT') fail('award issue', await api('POST', `/api/v1/admin/awards/${award.id}/issue`, institutionHeaders));
  const archivedAward = await queryOne("select id,status from awards where ranking_id=$1 and competition_entry_id=$2 and award_type='CERTIFICATE'", [ranking.id, teamEntry.id]) ?? fail('award create archived', await api('POST', '/api/v1/admin/awards', institutionHeaders, { rankingId: ranking.id, competitionEntryId: teamEntry.id, awardType: 'CERTIFICATE', label: 'شهادة تجريبية مؤرشفة', regulationVersionId: version.id }));
  if (archivedAward.status === 'DRAFT') { fail('award issue archived', await api('POST', `/api/v1/admin/awards/${archivedAward.id}/issue`, institutionHeaders)); fail('award revoke', await api('POST', `/api/v1/admin/awards/${archivedAward.id}/revoke`, institutionHeaders)); fail('award archive', await api('POST', `/api/v1/admin/awards/${archivedAward.id}/archive`, institutionHeaders)); }
  const finalCompetition = await queryOne('select status from competitions where id=$1', [competition.id]);
  if (finalCompetition.status !== 'RESULTS') throw new Error(`Expected competition to be RESULTS, got ${finalCompetition.status}`);
  let license = await queryOne('select id from sports_licenses where participant_id=$1 and archived_at is null', [participants[0].id]);
  let verificationReference = null;
  if (!license) { const created = fail('license create', await api('POST', '/api/v1/admin/licenses', national, { participantId: participants[0].id, expiresAt: '2027-06-30' })); verificationReference = created.verificationReference; license = { id: created.id }; }

  const [counts, publicCompetitions, publicResults, publicAwards, publicRecords] = await Promise.all([
    pool.query("select (select count(*)::int from competitions where name=$1) competitions,(select count(*)::int from competition_stages where competition_id=$2) stages,(select count(*)::int from competition_entries ce join individual_entries ie on ie.competition_entry_id=ce.id where ce.stage_id=$3) individual_entries,(select count(*)::int from competition_entries ce join team_entries te on te.competition_entry_id=ce.id where ce.stage_id=$3) team_entries,(select count(*)::int from result_revisions rr join results r on r.id=rr.result_id where r.competition_id=$2) result_revisions,(select count(*)::int from results where competition_id=$2 and governed_status='VALIDATED') official_results,(select count(*)::int from result_validations rv join results r on r.id=rv.result_id where r.competition_id=$2) decisions,(select count(*)::int from qualifications q join competition_entries ce on ce.id=q.source_entry_id where ce.stage_id=$3) qualifications,(select count(*)::int from rankings where stage_id=$3) rankings,(select count(*)::int from ranking_rows rr join rankings r on r.id=rr.ranking_id where r.stage_id=$3) ranking_rows,(select count(*)::int from awards a join competition_entries ce on ce.id=a.competition_entry_id where ce.stage_id=$3 and a.status='ISSUED') issued_awards,(select count(*)::int from awards a join competition_entries ce on ce.id=a.competition_entry_id where ce.stage_id=$3 and a.status in ('REVOKED','ARCHIVED')) revoked_archived_awards,(select count(*)::int from sports_licenses where participant_id=$4) demo_licenses", [name, competition.id, sourceStage.id, participants[0].id]),
    api('GET', `/api/v1/public/competitions?seasonId=${season.id}`, {}), api('GET', `/api/v1/public/results?competitionId=${competition.id}`, {}), api('GET', `/api/v1/public/awards?competitionId=${competition.id}`, {}), api('GET', `/api/v1/public/records?competitionId=${competition.id}`, {})
  ]);
  console.log(JSON.stringify({ competitionId: competition.id, sourceStageId: sourceStage.id, destinationStageId: destinationStage.id, verificationReference, counts: counts.rows[0], public: { competitions: publicCompetitions.json().data.length, results: publicResults.json().data.length, awards: publicAwards.json().data.length, records: publicRecords.json().data.length } }, null, 2));
} finally {
  await app.close();
  await pool.end();
}
