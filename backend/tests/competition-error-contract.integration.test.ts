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

async function fixture(institutionId: string) {
  const tag = `A5E-${Date.now()}-${sequence++}`;
  const season = (await pool!.query("insert into seasons(name,start_date,end_date) values($1,'2062-01-01','2062-12-31') returning id", [tag])).rows[0].id;
  const programme = (await pool!.query("insert into competition_programmes(season_id,code,title,effective_from) values($1,$2,$2,'2062-01-01') returning id", [season, tag])).rows[0].id;
  const version = (await pool!.query("insert into regulation_versions(version_no,programme_id,effective_period) values('1',$1,'[2062-01-01,2063-01-01)') returning id", [programme])).rows[0].id;
  const competition = (await pool!.query('insert into competitions(season_id,name) values($1,$2) returning id', [season, tag])).rows[0].id;
  const stage = (await pool!.query("insert into competition_stages(competition_id,programme_id,regulation_version_id,stage_level_code) values($1,$2,$3,'W') returning id", [competition, programme, version])).rows[0].id;
  const category = (await pool!.query("insert into categories(programme_id,code,name,gender_code,regulation_version_id) values($1,$2,$2,'OPEN',$3) returning id", [programme, tag, version])).rows[0].id;
  const otherCategory = (await pool!.query("insert into categories(programme_id,code,name,gender_code,regulation_version_id) values($1,$2,$2,'OPEN',$3) returning id", [programme, `${tag}-other`, version])).rows[0].id;
  const sport = (await pool!.query("insert into sports(code,name,sport_type) values($1,$1,'INDIVIDUAL') returning id", [tag])).rows[0].id;
  const event = (await pool!.query("insert into events(sport_id,code,name,format) values($1,$2,$2,'INDIVIDUAL') returning id", [sport, tag])).rows[0].id;
  const otherEvent = (await pool!.query("insert into events(sport_id,code,name,format) values($1,$2,$2,'INDIVIDUAL') returning id", [sport, `${tag}-other`])).rows[0].id;
  const occurrence = (await pool!.query("insert into calendar_occurrences(stage_id,event_id,category_id,regulation_version_id,start_at) values($1,$2,$3,$4,'2062-02-01') returning id", [stage, event, category, version])).rows[0].id;
  const participant = (await pool!.query("insert into participants(institution_id,given_name) values($1,'Error Contract') returning id", [institutionId])).rows[0].id;
  const entry = (await pool!.query("insert into competition_entries(stage_id,category_id,institution_id,entry_type,regulation_version_id) values($1,$2,$3,'INDIVIDUAL',$4) returning id", [stage, category, institutionId, version])).rows[0].id;
  await pool!.query("insert into individual_entries(competition_entry_id,participant_id,stage_id,category_id,participation_state) values($1,$2,$3,$4,'DRAFT')", [entry, participant, stage, category]);
  const mismatchedTeam = (await pool!.query("insert into teams(institution_id,category_id,stage_id,name) values($1,$2,$3,$4) returning id", [institutionId, otherCategory, stage, `${tag}-team`])).rows[0].id;
  return { version, stage, category, otherCategory, event, otherEvent, occurrence, entry, mismatchedTeam };
}

function noLeak(response: { body: string }) {
  expect(response.body).not.toMatch(/postgres|sql|constraint|trigger|plpgsql|stack|driver|detail|nssms_/i);
}

suite('ARCH-014 competition HTTP error contract', () => {
  beforeAll(async () => { await app!.ready(); });
  afterAll(async () => { await app?.close(); await pool?.end(); });

  it('maps conflict, invalid state, invalid context, and validation errors without database leakage', async () => {
    const headers = await login();
    const me = await app!.inject({ method: 'GET', url: '/api/v1/auth/me', headers });
    const x = await fixture(me.json().user.institutionId as string);
    await pool!.query("insert into competition_stage_scope_eligibility(stage_id,scope_type,institution_id) values($1,'INSTITUTION',$2)", [x.stage, me.json().user.institutionId]);
    const rankingBody = { stageId: x.stage, occurrenceId: x.occurrence, eventId: x.event, categoryId: x.category, regulationVersionId: x.version, rankingType: 'EVENT', calculationVersion: 'error-contract' };
    const created = await app!.inject({ method: 'POST', url: '/api/v1/admin/rankings', headers, payload: rankingBody });
    expect(created.statusCode).toBe(200);
    const rankingId = created.json().data.id as string;

    const firstRow = await app!.inject({ method: 'POST', url: `/api/v1/admin/rankings/${rankingId}/rows`, headers, payload: { competitionEntryId: x.entry, position: 1 } });
    expect(firstRow.statusCode).toBe(200);
    const conflict = await app!.inject({ method: 'POST', url: `/api/v1/admin/rankings/${rankingId}/rows`, headers, payload: { competitionEntryId: x.entry, position: 2 } });
    expect(conflict.statusCode).toBe(409); expect(conflict.json()).toEqual({ error: 'conflict' }); noLeak(conflict);

    const invalidState = await app!.inject({ method: 'POST', url: `/api/v1/admin/rankings/${rankingId}/publish`, headers });
    expect(invalidState.statusCode).toBe(409); expect(invalidState.json()).toEqual({ error: 'invalid_state' }); noLeak(invalidState);

    const invalidContext = await app!.inject({ method: 'POST', url: '/api/v1/admin/rankings', headers, payload: { ...rankingBody, eventId: x.otherEvent } });
    expect(invalidContext.statusCode).toBe(422); expect(invalidContext.json()).toEqual({ error: 'invalid_context' }); noLeak(invalidContext);

    const validationError = await app!.inject({ method: 'POST', url: '/api/v1/admin/competition-entries', headers, payload: { stageId: x.stage, categoryId: x.category, institutionId: me.json().user.institutionId, regulationVersionId: x.version, teamId: x.mismatchedTeam } });
    expect(validationError.statusCode).toBe(422); expect(validationError.json()).toEqual({ error: 'validation_error' }); noLeak(validationError);
  });
});
