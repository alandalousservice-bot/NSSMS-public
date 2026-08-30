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

async function entryFixture(institutionId: string, organizationId: string) {
  const tag = `B4-${Date.now()}-${sequence++}`;
  const season = (await pool!.query("insert into seasons(name,start_date,end_date) values($1,'2074-01-01','2074-12-31') returning id", [tag])).rows[0].id;
  const programme = (await pool!.query("insert into competition_programmes(season_id,code,title,effective_from) values($1,$2,$2,'2074-01-01') returning id", [season, tag])).rows[0].id;
  const version = (await pool!.query("insert into regulation_versions(version_no,programme_id,effective_period) values('1',$1,'[2074-01-01,2075-01-01)') returning id", [programme])).rows[0].id;
  const competition = (await pool!.query('insert into competitions(season_id,name) values($1,$2) returning id', [season, tag])).rows[0].id;
  const stage = (await pool!.query("insert into competition_stages(competition_id,programme_id,regulation_version_id,stage_level_code,host_organization_id) values($1,$2,$3,'W',$4) returning id", [competition, programme, version, organizationId])).rows[0].id;
  const category = (await pool!.query("insert into categories(programme_id,code,name,gender_code,regulation_version_id) values($1,$2,$2,'OPEN',$3) returning id", [programme, tag, version])).rows[0].id;
  const participant = (await pool!.query("insert into participants(institution_id,given_name,family_name) values($1,'Candidate',$2) returning id", [institutionId, tag])).rows[0].id;
  return { stage, category, version, participant };
}

suite('ARCH-016 B4 scoped actor reference lookups', () => {
  beforeAll(async () => { await app!.ready(); });
  afterAll(async () => { await app?.close(); await pool?.end(); });

  it('uses normalized, scoped SQL reference collections for eligibility grants and the first individual Entry', async () => {
    const national = await login('demo.admin', 'NssmsDemoAdmin-2026!');
    const association = await login('assoc.w01.admin', 'NssmsAssoc-W01-2026!');
    const daira = await login('daira.001.admin', 'NssmsDaira-001-2026!');
    const institution = await login('institution.001.demo', 'NssmsInst-001-2026!');
    const me = await app!.inject({ method: 'GET', url: '/api/v1/auth/me', headers: institution });
    const dairaMe = await app!.inject({ method: 'GET', url: '/api/v1/auth/me', headers: daira });
    const institutionId = me.json().user.institutionId;
    const dairaId = Number(dairaMe.json().user.dairaId);
    const organizationId = (await pool!.query("select id from organizations where code='WILAYA-01'")).rows[0].id;
    const foreignOrganizationId = (await pool!.query("select id from organizations where code='WILAYA-02'")).rows[0].id;
    const foreignInstitutionId = (await pool!.query('select id from educational_institutions where organization_id=$1 limit 1', [foreignOrganizationId])).rows[0].id;
    const foreignParticipantId = (await pool!.query("insert into participants(institution_id,given_name,family_name) values($1,'Foreign','Candidate') returning id", [foreignInstitutionId])).rows[0].id;

    const organizations = await app!.inject({ method: 'GET', url: '/api/v1/admin/competition-reference/organizations', headers: national });
    expect(organizations.statusCode).toBe(200); expect(organizations.json()).toMatchObject({ meta: { pagination: { limit: 25, offset: 0 } } });
    const organizationContext = (await pool!.query("select id,wilaya_id from organizations where code='WILAYA-01'")).rows[0];
    const byWilaya = await app!.inject({ method: 'GET', url: `/api/v1/admin/competition-reference/organizations?wilaya_id=${organizationContext.wilaya_id}&limit=100`, headers: national });
    expect(byWilaya.statusCode).toBe(200); expect(byWilaya.json().data.every((row: { wilaya_id: number }) => row.wilaya_id === organizationContext.wilaya_id)).toBe(true);
    const organization = byWilaya.json().data.find((row: { id: string }) => row.id === organizationId);
    expect(organization).toMatchObject({ id: organizationId, label: expect.any(String), wilaya_id: organizationContext.wilaya_id });
    const organizationDenied = await app!.inject({ method: 'GET', url: '/api/v1/admin/competition-reference/organizations', headers: association });
    expect(organizationDenied.statusCode).toBe(403); expect(organizationDenied.json().error).toBe('forbidden'); noLeak(organizationDenied);

    const nationalInstitutions = await app!.inject({ method: 'GET', url: `/api/v1/admin/competition-reference/institutions?organization_id=${organizationId}`, headers: national });
    expect(nationalInstitutions.statusCode).toBe(200); expect(nationalInstitutions.json().data[0]).toMatchObject({ id: expect.any(String), label: expect.any(String), organization_id: organizationId, daira_id: expect.any(Number) });
    const associationInstitutions = await app!.inject({ method: 'GET', url: '/api/v1/admin/competition-reference/institutions', headers: association });
    expect(associationInstitutions.json().data.every((row: { organization_id: string }) => row.organization_id === organizationId)).toBe(true);
    const dairaInstitutions = await app!.inject({ method: 'GET', url: '/api/v1/admin/competition-reference/institutions', headers: daira });
    expect(dairaInstitutions.json().data.every((row: { daira_id: number }) => row.daira_id === dairaId)).toBe(true);
    const ownInstitution = await app!.inject({ method: 'GET', url: '/api/v1/admin/competition-reference/institutions', headers: institution });
    expect(ownInstitution.json().data).toMatchObject([{ id: institutionId }]);
    const institutionCandidate = ownInstitution.json().data.find((row: { id: string }) => row.id === institutionId);
    expect(institutionCandidate).toMatchObject({ id: institutionId, label: expect.any(String) });
    const noWidenInstitution = await app!.inject({ method: 'GET', url: `/api/v1/admin/competition-reference/institutions?organization_id=${foreignOrganizationId}`, headers: association });
    expect(noWidenInstitution.json().data).toEqual([]);

    const x = await entryFixture(institutionId, organizationId);
    const nationalParticipants = await app!.inject({ method: 'GET', url: `/api/v1/admin/competition-reference/participants?institution_id=${institutionId}&limit=100`, headers: national });
    expect(nationalParticipants.statusCode).toBe(200); expect(nationalParticipants.json().data).toContainEqual(expect.objectContaining({ id: x.participant, label: expect.any(String), institution_id: institutionId }));
    const associationParticipants = await app!.inject({ method: 'GET', url: '/api/v1/admin/competition-reference/participants', headers: association });
    expect(associationParticipants.json().data.every((row: { institution_id: string }) => associationInstitutions.json().data.some((institutionRow: { id: string }) => institutionRow.id === row.institution_id))).toBe(true);
    const dairaParticipants = await app!.inject({ method: 'GET', url: '/api/v1/admin/competition-reference/participants', headers: daira });
    expect(dairaParticipants.json().data.every((row: { institution_id: string }) => dairaInstitutions.json().data.some((institutionRow: { id: string }) => institutionRow.id === row.institution_id))).toBe(true);
    const ownParticipants = await app!.inject({ method: 'GET', url: '/api/v1/admin/competition-reference/participants?limit=100', headers: institution });
    expect(ownParticipants.json().data.some((row: { id: string }) => row.id === x.participant)).toBe(true);
    expect(ownParticipants.json().data.some((row: { id: string }) => row.id === foreignParticipantId)).toBe(false);
    const participantCandidate = ownParticipants.json().data.find((row: { id: string }) => row.id === x.participant);
    expect(participantCandidate).toMatchObject({ id: x.participant, institution_id: institutionCandidate.id });
    const noWidenParticipant = await app!.inject({ method: 'GET', url: `/api/v1/admin/competition-reference/participants?institution_id=${foreignInstitutionId}`, headers: institution });
    expect(noWidenParticipant.json().data).toEqual([]);

    const grants = [
      { scopeType: 'ORGANIZATION', organizationId: organization.id },
      { scopeType: 'INSTITUTION', institutionId: institutionCandidate.id }
    ];
    for (const payload of grants) expect((await app!.inject({ method: 'POST', url: `/api/v1/admin/competition-stages/${x.stage}/eligibility`, headers: national, payload })).statusCode).toBe(200);
    const firstEntry = await app!.inject({ method: 'POST', url: '/api/v1/admin/competition-entries', headers: institution, payload: { stageId: x.stage, categoryId: x.category, institutionId: institutionCandidate.id, regulationVersionId: x.version, participantId: participantCandidate.id } });
    expect(firstEntry.statusCode).toBe(200);
    expect(firstEntry.json().data).toMatchObject({ institution_id: institutionId, entry_type: 'INDIVIDUAL' });
  });

  it('rejects invalid reference filters and pagination without leaking internal details', async () => {
    const national = await login('demo.admin', 'NssmsDemoAdmin-2026!');
    const cases = [
      '/api/v1/admin/competition-reference/organizations?wilaya_id=invalid',
      '/api/v1/admin/competition-reference/institutions?organization_id=invalid',
      '/api/v1/admin/competition-reference/institutions?daira_id=-1',
      '/api/v1/admin/competition-reference/participants?institution_id=invalid',
      '/api/v1/admin/competition-reference/participants?limit=101',
      '/api/v1/admin/competition-reference/participants?offset=-1'
    ];
    for (const url of cases) {
      const response = await app!.inject({ method: 'GET', url, headers: national });
      expect(response.statusCode).toBe(422); expect(response.json().error).toBe('validation_error'); noLeak(response);
    }
  });
});
