import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import pg from 'pg';
import { buildApp } from '../src/app.js';

const enabled = Boolean(process.env.DATABASE_URL && process.env.AUTH_SECRET);
const suite = enabled ? describe : describe.skip;
const pool = enabled ? new pg.Pool({ connectionString: process.env.DATABASE_URL }) : null;
const app = enabled ? buildApp() : null;

async function login(username: string, password: string) {
  const response = await app!.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { username, password } });
  expect(response.statusCode).toBe(200);
  return { authorization: `Bearer ${response.json().token}` };
}

suite('centralized authorization scope', () => {
  let organizationA = ''; let organizationB = ''; let institutionA = ''; let institutionB = '';
  beforeAll(async () => {
    await app!.ready();
    const organizations = await pool!.query("SELECT id FROM organizations WHERE code IN ('WILAYA-01','WILAYA-02') ORDER BY code");
    const institutions = await pool!.query("SELECT id,organization_id FROM educational_institutions WHERE organization_id = ANY($1::uuid[]) ORDER BY organization_id,id", [organizations.rows.map((row) => row.id)]);
    organizationA = organizations.rows[0]?.id ?? ''; organizationB = organizations.rows[1]?.id ?? '';
    institutionA = institutions.rows.find((row) => row.organization_id === organizationA)?.id ?? '';
    institutionB = institutions.rows.find((row) => row.organization_id === organizationB)?.id ?? '';
  });
  afterAll(async () => { await app?.close(); await pool?.end(); });

  it('allows national access and filters association collections by organization', async () => {
    expect(organizationA).toBeTruthy(); expect(organizationB).toBeTruthy(); expect(institutionA).toBeTruthy(); expect(institutionB).toBeTruthy();
    const national = await login('demo.admin', 'NssmsDemoAdmin-2026!');
    const all = await app!.inject({ method: 'GET', url: '/api/v1/admin/institutions', headers: national });
    expect(all.statusCode).toBe(200); expect(all.json().data.some((row: any) => row.id === institutionB)).toBe(true);
    const association = await login('assoc.w01.admin', 'NssmsAssoc-W01-2026!');
    const scoped = await app!.inject({ method: 'GET', url: '/api/v1/admin/institutions', headers: association });
    expect(scoped.statusCode).toBe(200); expect(scoped.json().data.every((row: any) => row.organization_id === organizationA)).toBe(true);
    const idor = await app!.inject({ method: 'PATCH', url: `/api/v1/admin/institutions/${institutionB}`, headers: association, payload: { name: 'IDOR attempt' } });
    expect(idor.statusCode).toBe(403);
  });

  it('keeps daira and institution users inside their assigned hierarchy', async () => {
    const daira = await login('daira.001.admin', 'NssmsDaira-001-2026!');
    const dairaInstitutions = await app!.inject({ method: 'GET', url: '/api/v1/admin/institutions', headers: daira });
    expect(dairaInstitutions.statusCode).toBe(200); expect(dairaInstitutions.json().data.every((row: any) => row.daira_id === 1)).toBe(true);
    const institution = await login('institution.001.demo', 'NssmsInst-001-2026!');
    const me = await app!.inject({ method: 'GET', url: '/api/v1/auth/me', headers: institution });
    const own = await app!.inject({ method: 'GET', url: '/api/v1/admin/institutions', headers: institution });
    expect(own.statusCode).toBe(200); expect(own.json().data.every((row: any) => row.id === me.json().user.institutionId)).toBe(true);
    const denied = await app!.inject({ method: 'PATCH', url: `/api/v1/admin/institutions/${institutionB}`, headers: institution, payload: { name: 'IDOR attempt' } });
    expect(denied.statusCode).toBe(403);
  });

  it('prevents cross-organization participant reads and direct writes', async () => {
    const national = await login('demo.admin', 'NssmsDemoAdmin-2026!');
    const created = await app!.inject({ method: 'POST', url: '/api/v1/admin/participants', headers: national, payload: { institutionId: institutionB, givenName: 'Scope', familyName: `Isolation-${Date.now()}` } });
    expect(created.statusCode).toBe(201); const participantId = created.json().data.id;
    const associationA = await login('assoc.w01.admin', 'NssmsAssoc-W01-2026!');
    const associationB = await login('assoc.w02.admin', 'NssmsAssoc-W02-2026!');
    const foreignRead = await app!.inject({ method: 'GET', url: '/api/v1/admin/participants', headers: associationA });
    expect(foreignRead.statusCode).toBe(200); expect(foreignRead.json().data.some((row: any) => row.id === participantId)).toBe(false);
    const ownRead = await app!.inject({ method: 'GET', url: '/api/v1/admin/participants', headers: associationB });
    expect(ownRead.statusCode).toBe(200); expect(ownRead.json().data.some((row: any) => row.id === participantId)).toBe(true);
    const foreignWrite = await app!.inject({ method: 'PATCH', url: `/api/v1/admin/participants/${participantId}`, headers: associationA, payload: { givenName: 'Blocked' } });
    expect(foreignWrite.statusCode).toBe(403);
  });
});
