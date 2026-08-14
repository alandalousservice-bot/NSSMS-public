import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { buildApp } from '../src/app.js';

const enabled = Boolean(process.env.DATABASE_URL && process.env.AUTH_SECRET);
const suite = enabled ? describe : describe.skip;
const pool = enabled ? new pg.Pool({ connectionString: process.env.DATABASE_URL }) : null;
const app = enabled ? buildApp() : null;

suite('NSSMS core workflow', () => {
  let token = '';
  let institutionId = '';
  beforeAll(async () => {
    await app!.ready();
    const institution = await pool!.query('SELECT id FROM educational_institutions WHERE archived_at IS NULL LIMIT 1');
    institutionId = institution.rows[0]?.id;
  });
  afterAll(async () => { await app?.close(); await pool?.end(); });
  it('completes the governed setup-to-verification flow', async () => {
    expect(institutionId).toBeTruthy();
    const login = await app!.inject({ method:'POST', url:'/api/v1/auth/login', payload:{ username:'demo.admin', password:'NssmsDemoAdmin-2026!' } });
    expect(login.statusCode).toBe(200); token = login.json().token;
    const auth = { authorization:`Bearer ${token}` };
    const me = await app!.inject({method:'GET',url:'/api/v1/auth/me',headers:auth});
    expect(me.statusCode).toBe(200); expect(me.json().user.username).toBe('demo.admin');
    const suffix = randomUUID().slice(0, 8);
    const season = await app!.inject({ method:'POST', url:'/api/v1/admin/seasons', headers:auth, payload:{name:`Integration Season ${suffix}`,startDate:'2026-09-01',endDate:'2027-06-30'} });
    expect(season.statusCode).toBe(201); const seasonId = season.json().data.id;
    expect((await app!.inject({method:'POST',url:`/api/v1/admin/seasons/${seasonId}/transition`,headers:auth,payload:{to:'UNDER_REVIEW'}})).statusCode).toBe(200);
    expect((await app!.inject({method:'POST',url:`/api/v1/admin/seasons/${seasonId}/transition`,headers:auth,payload:{to:'APPROVED'}})).statusCode).toBe(200);
    expect((await app!.inject({method:'POST',url:`/api/v1/admin/seasons/${seasonId}/transition`,headers:auth,payload:{to:'ACTIVE'}})).statusCode).toBe(200);
    const competition = await app!.inject({method:'POST',url:'/api/v1/admin/competitions',headers:auth,payload:{seasonId,name:`Integration Competition ${suffix}`}});
    expect(competition.statusCode).toBe(201); const competitionId=competition.json().data.id;
    for (const to of ['REVIEW','APPROVED','REGISTRATION','ACTIVE']) expect((await app!.inject({method:'POST',url:`/api/v1/admin/competitions/${competitionId}/transition`,headers:auth,payload:{to}})).statusCode).toBe(200);
    const participant = await app!.inject({method:'POST',url:'/api/v1/admin/participants',headers:auth,payload:{institutionId,givenName:'Integration',familyName:suffix}});
    expect(participant.statusCode).toBe(201); const participantId=participant.json().data.id;
    const license = await app!.inject({method:'POST',url:'/api/v1/admin/licenses',headers:auth,payload:{participantId}});
    expect(license.statusCode).toBe(201); const reference=license.json().verificationReference;
    const licenseId=license.json().data.id;
    for (const to of ['EXPIRED','ARCHIVED']) expect((await app!.inject({method:'POST',url:`/api/v1/admin/licenses/${licenseId}/transition`,headers:auth,payload:{to}})).statusCode).toBe(200);
    const verification = await app!.inject({method:'GET',url:`/api/v1/public/licenses/verify/${reference}`});
    expect(verification.statusCode).toBe(200); expect(verification.json().verified).toBe(true);
    const audit = await app!.inject({method:'GET',url:'/api/v1/admin/audit?action=ISSUE&entityType=LICENSE',headers:auth});
    expect(audit.statusCode).toBe(200); expect(audit.json().data.length).toBeGreaterThan(0);
    const eventId = audit.json().data[0].id;
    const detail = await app!.inject({method:'GET',url:`/api/v1/admin/audit/${eventId}`,headers:auth});
    expect(detail.statusCode).toBe(200); expect(detail.json().data.id).toBe(eventId);
    const breakdown = await app!.inject({method:'GET',url:'/api/v1/admin/reports/status-breakdown',headers:auth});
    expect(breakdown.statusCode).toBe(200);
    expect(breakdown.json().data).toHaveProperty('seasons');
    expect(breakdown.json().data).toHaveProperty('competitions');
    expect(breakdown.json().data).toHaveProperty('licenses');
    const logout = await app!.inject({method:'POST',url:'/api/v1/auth/logout',headers:auth});
    expect(logout.statusCode).toBe(200); expect(logout.json().success).toBe(true);
  });
});
