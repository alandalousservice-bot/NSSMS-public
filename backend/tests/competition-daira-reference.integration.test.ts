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

function noLeak(response: { body: string }) {
  expect(response.body).not.toMatch(/postgres|sql|constraint|trigger|plpgsql|stack|driver|detail|nssms_/i);
}

async function draftStage(hostOrganizationId: string) {
  const tag = `B3-${Date.now()}-${sequence++}`;
  const season = (await pool!.query("insert into seasons(name,start_date,end_date) values($1,'2073-01-01','2073-12-31') returning id", [tag])).rows[0].id;
  const programme = (await pool!.query("insert into competition_programmes(season_id,code,title,effective_from) values($1,$2,$2,'2073-01-01') returning id", [season, tag])).rows[0].id;
  const version = (await pool!.query("insert into regulation_versions(version_no,programme_id,effective_period) values('1',$1,'[2073-01-01,2074-01-01)') returning id", [programme])).rows[0].id;
  const competition = (await pool!.query('insert into competitions(season_id,name) values($1,$2) returning id', [season, tag])).rows[0].id;
  return (await pool!.query("insert into competition_stages(competition_id,programme_id,regulation_version_id,stage_level_code,host_organization_id) values($1,$2,$3,'W',$4) returning id", [competition, programme, version, hostOrganizationId])).rows[0].id;
}

suite('ARCH-016 B3 protected Daira reference lookup', () => {
  beforeAll(async () => { await app!.ready(); });
  afterAll(async () => { await app?.close(); await pool?.end(); });

  it('returns a bounded national Daira catalogue and accepts its authoritative id for a DRAFT-stage eligibility grant', async () => {
    const national = await login('demo.admin', 'NssmsDemoAdmin-2026!');
    const institution = await login('institution.001.demo', 'NssmsInst-001-2026!');
    const first = await app!.inject({ method: 'GET', url: '/api/v1/admin/competition-reference/dairas', headers: national });
    expect(first.statusCode).toBe(200);
    expect(first.json()).toMatchObject({ meta: { pagination: { limit: 25, offset: 0 } } });
    expect(first.json().data.length).toBeGreaterThan(0);
    expect(first.json().data[0]).toMatchObject({ id: expect.any(Number), label: expect.any(String), wilaya_id: expect.any(Number) });
    const repeated = await app!.inject({ method: 'GET', url: '/api/v1/admin/competition-reference/dairas', headers: national });
    expect(repeated.json().data.map((row: { id: number }) => row.id)).toEqual(first.json().data.map((row: { id: number }) => row.id));
    const candidate = first.json().data[0];
    const byWilaya = await app!.inject({ method: 'GET', url: `/api/v1/admin/competition-reference/dairas?wilaya_id=${candidate.wilaya_id}&limit=100`, headers: national });
    expect(byWilaya.statusCode).toBe(200);
    expect(byWilaya.json()).toMatchObject({ meta: { pagination: { limit: 100, offset: 0 } } });
    expect(byWilaya.json().data.every((row: { wilaya_id: number }) => row.wilaya_id === candidate.wilaya_id)).toBe(true);
    const hostOrganizationId = (await pool!.query("select id from organizations where code='WILAYA-01'")).rows[0].id;
    const stageId = await draftStage(hostOrganizationId);
    const grant = await app!.inject({ method: 'POST', url: `/api/v1/admin/competition-stages/${stageId}/eligibility`, headers: national, payload: { scopeType: 'DAIRA', dairaId: candidate.id } });
    expect(grant.statusCode).toBe(200);
    expect(grant.json().data).toMatchObject({ stage_id: stageId, scope_type: 'DAIRA', daira_id: candidate.id });
    const grants = await app!.inject({ method: 'GET', url: `/api/v1/admin/competition-stages/${stageId}/eligibility`, headers: national });
    expect(grants.statusCode).toBe(200);
    expect(grants.json().data).toMatchObject([{ id: grant.json().data.id, daira_id: candidate.id }]);
    const denied = await app!.inject({ method: 'GET', url: '/api/v1/admin/competition-reference/dairas', headers: institution });
    expect(denied.statusCode).toBe(403); expect(denied.json().error).toBe('forbidden'); noLeak(denied);
  });

  it('rejects invalid pagination and Wilaya filters without leaking database details', async () => {
    const national = await login('demo.admin', 'NssmsDemoAdmin-2026!');
    for (const query of ['wilaya_id=invalid', 'wilaya_id=-1', 'limit=101', 'limit=-1', 'offset=-1', 'offset=invalid']) {
      const response = await app!.inject({ method: 'GET', url: `/api/v1/admin/competition-reference/dairas?${query}`, headers: national });
      expect(response.statusCode).toBe(422);
      expect(response.json().error).toBe('validation_error');
      noLeak(response);
    }
  });
});
