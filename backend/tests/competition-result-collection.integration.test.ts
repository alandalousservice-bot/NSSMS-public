import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import pg from 'pg';
import { buildApp } from '../src/app.js';

const enabled = Boolean(process.env.DATABASE_URL && process.env.AUTH_SECRET);
const suite = enabled ? describe : describe.skip;
const pool = enabled ? new pg.Pool({ connectionString: process.env.DATABASE_URL }) : null;
const app = enabled ? buildApp() : null;
let sequence = 0;

async function login(username = 'institution.001.demo') { const response = await app!.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { username, password: username === 'institution.001.demo' ? 'NssmsInst-001-2026!' : 'NssmsAssoc-W02-2026!' } }); expect(response.statusCode).toBe(200); return { authorization: `Bearer ${response.json().token}` }; }
async function fixture(institutionId: string) {
  const tag = `B2-${Date.now()}-${sequence++}`;
  const season = (await pool!.query("insert into seasons(name,start_date,end_date) values($1,'2073-01-01','2073-12-31') returning id", [tag])).rows[0].id;
  const programme = (await pool!.query("insert into competition_programmes(season_id,code,title,effective_from) values($1,$2,$2,'2073-01-01') returning id", [season, tag])).rows[0].id;
  const version = (await pool!.query("insert into regulation_versions(version_no,programme_id,effective_period) values('1',$1,'[2073-01-01,2074-01-01)') returning id", [programme])).rows[0].id;
  const competition = (await pool!.query('insert into competitions(season_id,name) values($1,$2) returning id', [season, tag])).rows[0].id;
  const stage = (await pool!.query("insert into competition_stages(competition_id,programme_id,regulation_version_id,stage_level_code) values($1,$2,$3,'W') returning id", [competition, programme, version])).rows[0].id;
  const category = (await pool!.query("insert into categories(programme_id,code,name,gender_code,regulation_version_id) values($1,$2,$2,'OPEN',$3) returning id", [programme, tag, version])).rows[0].id;
  const sport = (await pool!.query("insert into sports(code,name,sport_type) values($1,$1,'INDIVIDUAL') returning id", [tag])).rows[0].id;
  const event = (await pool!.query("insert into events(sport_id,code,name,format) values($1,$2,$2,'INDIVIDUAL') returning id", [sport, tag])).rows[0].id;
  const occurrence = (await pool!.query("insert into calendar_occurrences(stage_id,event_id,category_id,regulation_version_id,start_at) values($1,$2,$3,$4,'2073-02-01') returning id", [stage, event, category, version])).rows[0].id;
  const participant = (await pool!.query("insert into participants(institution_id,given_name) values($1,'Result candidate') returning id", [institutionId])).rows[0].id;
  const entry = (await pool!.query("insert into competition_entries(stage_id,category_id,institution_id,entry_type,regulation_version_id) values($1,$2,$3,'INDIVIDUAL',$4) returning id", [stage, category, institutionId, version])).rows[0].id;
  await pool!.query("insert into individual_entries(competition_entry_id,participant_id,stage_id,category_id,participation_state) values($1,$2,$3,$4,'DRAFT')", [entry, participant, stage, category]);
  const result = (await pool!.query("insert into results(competition_id,stage_id,occurrence_id,event_id,category_id,competition_entry_id,regulation_version_id,governed_status,result_data) values($1,$2,$3,$4,$5,$6,$7,'DRAFT',$8) returning id", [competition, stage, occurrence, event, category, entry, version, { score: 9 }])).rows[0].id;
  return { result, entry, stage, occurrence, event, category, version };
}

suite('ARCH-016 scoped Result collection candidates', () => {
  beforeAll(async () => { await app!.ready(); });
  afterAll(async () => { await app?.close(); await pool?.end(); });

  it('returns only scoped, normalized current validation candidates with bounded pagination', async () => {
    const headers = await login(); const me = await app!.inject({ method: 'GET', url: '/api/v1/auth/me', headers });
    const own = await fixture(me.json().user.institutionId);
    const foreignInstitution = (await pool!.query('select id from educational_institutions where id<>$1 limit 1', [me.json().user.institutionId])).rows[0].id;
    const foreign = await fixture(foreignInstitution);
    expect((await app!.inject({ method: 'POST', url: `/api/v1/admin/competition-results/${own.result}/submit`, headers })).statusCode).toBe(200);
    const decision = await app!.inject({ method: 'POST', url: `/api/v1/admin/competition-results/${own.result}/validated`, headers, payload: { revisionNo: 0 } }); expect(decision.statusCode).toBe(200);
    const response = await app!.inject({ method: 'GET', url: `/api/v1/admin/competition-results?competition_entry_id=${own.entry}&limit=1&offset=0`, headers });
    expect(response.statusCode).toBe(200); expect(response.json().meta.pagination).toEqual({ limit: 1, offset: 0, total: 1 });
    expect(response.json().data).toEqual([expect.objectContaining({ id: own.result, competition_entry_id: own.entry, latest_revision_no: 0, is_evidence_candidate: true, current_validation: expect.objectContaining({ id: decision.json().data.id, decision: 'VALIDATED', revision_no: 0 }) })]);
    const superseding = await app!.inject({ method: 'POST', url: `/api/v1/admin/competition-results/${own.result}/rejected`, headers, payload: { revisionNo: 0, supersedesValidationId: decision.json().data.id } }); expect(superseding.statusCode).toBe(200);
    const current = await app!.inject({ method: 'GET', url: `/api/v1/admin/competition-results?competition_entry_id=${own.entry}`, headers });
    expect(current.json().data[0]).toEqual(expect.objectContaining({ is_evidence_candidate: false, current_validation: expect.objectContaining({ id: superseding.json().data.id, decision: 'REJECTED' }) }));
    const scoped = await app!.inject({ method: 'GET', url: `/api/v1/admin/competition-results?stage_id=${foreign.stage}`, headers }); expect(scoped.statusCode).toBe(200); expect(scoped.json().data).toEqual([]);
    const invalid = await app!.inject({ method: 'GET', url: '/api/v1/admin/competition-results?competition_entry_id=invalid', headers }); expect(invalid.statusCode).toBe(422); expect(invalid.json().error).toBe('validation_error'); expect(invalid.body).not.toMatch(/postgres|sql|constraint|trigger|plpgsql|stack|driver|detail/i);
  });
});
