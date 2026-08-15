import Fastify from 'fastify';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import cors from '@fastify/cors';
import { z } from 'zod';
import { verifyLicense } from './services/verification.js';
import { encodePassword, login, readSession, verifyPassword } from './services/auth.js';
import { registerAdminRoutes } from './routes/admin.js';
import { registerCompetitionRoutes } from './routes/competition.js';
import { config } from './config.js';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';

export function buildApp() {
  const app = Fastify({ logger: { level: process.env.LOG_LEVEL ?? 'info' }, genReqId: () => randomUUID(), requestTimeout: config.requestTimeoutMs, bodyLimit: config.bodyLimit, trustProxy: config.trustProxy });
  app.addHook('onRequest', async (request, reply) => { reply.header('x-request-id', request.id); if (request.headers.authorization) reply.header('cache-control', 'private, no-store'); });
  const errorBody = (requestId: string, code: string, message: string) => ({ error: { code, message, request_id: requestId } });
  app.setErrorHandler((error, request, reply) => { const err = error as { statusCode?: number; code?: string; name?: string }; const status = err.statusCode && err.statusCode < 500 ? err.statusCode : 500; const code = status === 429 ? 'RATE_LIMITED' : status === 401 ? 'UNAUTHORIZED' : status === 403 ? 'FORBIDDEN' : status === 404 ? 'NOT_FOUND' : status === 400 || status === 413 || status === 422 ? 'VALIDATION_ERROR' : 'INTERNAL_ERROR'; request.log.error({ request_id: request.id, error_code: code, error_category: err.code ?? err.name ?? 'unhandled' }, 'request failed'); return reply.code(status).send(errorBody(request.id, code, code === 'INTERNAL_ERROR' ? 'An internal error occurred' : 'The request could not be completed')); });
  app.setNotFoundHandler((request, reply) => reply.code(404).send(errorBody(request.id, 'NOT_FOUND', 'Route not found')));
  app.register(helmet, { contentSecurityPolicy: { directives: { defaultSrc: ["'none'"], frameAncestors: ["'none'"] } }, referrerPolicy: { policy: 'no-referrer' } });
  app.register(cors, { origin: (origin, callback) => callback(null, !origin || config.corsOrigins.includes(origin)), credentials: true, methods: ['GET','POST','PATCH','PUT','DELETE','OPTIONS'], allowedHeaders: ['content-type','authorization','x-request-id'] });
  app.register(rateLimit, { max: config.rateLimitMax, timeWindow: config.rateLimitWindow, errorResponseBuilder: (request, context) => ({ statusCode: context.statusCode, error: { code: 'RATE_LIMITED', message: 'Too many requests', request_id: request.id } }) });
  const routeLimiters = new WeakMap<object, ReturnType<typeof app.rateLimit>>();
  app.addHook('onRequest', async (request, reply) => {
    const configuredLimit = request.routeOptions.config.rateLimit;
    let limiter = app.rateLimit();
    if (configuredLimit && typeof configuredLimit === 'object') {
      limiter = routeLimiters.get(configuredLimit) ?? app.rateLimit(configuredLimit);
      routeLimiters.set(configuredLimit, limiter);
    }
    await limiter.call(app, request, reply);
  });
  app.get('/health', async () => ({ status: 'ok', service: 'nssms-api' }));
  app.get('/api/v1', async () => ({ name:'NSSMS API', version:'1.0.0', status:'active' }));
  app.get('/openapi.json', async (_request, reply) => { reply.type('application/json'); return JSON.parse(await readFile(resolve(process.cwd(),'openapi.json'),'utf8')); });
  app.get('/ready', async (_request, reply) => { try { const { pool } = await import('./infrastructure/db.js'); await pool.query('SELECT 1'); return { status: 'ready', database: 'ok' }; } catch { return reply.code(503).send({ status: 'not_ready', database: 'unavailable' }); } });
  app.post('/api/v1/auth/login', { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, async (request, reply) => {
    const parsed = z.object({ username: z.string().min(3).max(100), password: z.string().min(12).max(200) }).safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: 'invalid_credentials' });
    const result = await login(parsed.data.username, parsed.data.password);
    if (!result) return reply.code(401).send({ error: 'invalid_credentials' });
    return result;
  });
  app.post('/api/v1/auth/institution-register', { config: { rateLimit: { max: 5, timeWindow: '1 minute' } } }, async (request, reply) => {
    const parsed = z.object({ username: z.string().min(3).max(100), password: z.string().min(12).max(200), displayName: z.string().min(2).max(200), institutionName: z.string().min(2).max(200), institutionCode: z.string().min(2).max(80), wilayaId: z.coerce.number().int().min(1).max(58), dairaId: z.coerce.number().int().nonnegative() }).safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: 'validation_error' });
    const { pool } = await import('./infrastructure/db.js');
    const { username, password, displayName, institutionName, institutionCode, wilayaId, dairaId } = parsed.data;
    const geography = await pool.query('SELECT d.id FROM dairas d WHERE d.id=$1 AND d.wilaya_id=$2', [dairaId, wilayaId]);
    if (!geography.rowCount) return reply.code(400).send({ error: 'invalid_geography' });
    const organization = await pool.query("SELECT id FROM organizations WHERE code=$1 AND wilaya_id=$2 AND organization_type='ASSOCIATION'", [`WILAYA-${String(wilayaId).padStart(2, '0')}`, wilayaId]);
    if (!organization.rowCount) return reply.code(404).send({ error: 'association_not_configured' });
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const institution = await client.query('INSERT INTO educational_institutions(organization_id,daira_id,name,code) VALUES($1,$2,$3,$4) ON CONFLICT(organization_id,code) DO UPDATE SET name=EXCLUDED.name,daira_id=EXCLUDED.daira_id RETURNING id', [organization.rows[0].id, dairaId, institutionName, institutionCode]);
      const user = await client.query("INSERT INTO users(username,display_name,password_hash,status,organization_id,institution_id,daira_id) VALUES($1,$2,$3,'PENDING',$4,$5,$6) RETURNING id,username,status", [username, displayName, encodePassword(password), organization.rows[0].id, institution.rows[0].id, dairaId]);
      await client.query("INSERT INTO user_roles(user_id,role_id) SELECT $1,id FROM roles WHERE name='MEMBER_INSTITUTION_USER' ON CONFLICT DO NOTHING", [user.rows[0].id]);
      await client.query('INSERT INTO audit_logs(action,entity_type,entity_id,result_status,metadata) VALUES($1,$2,$3,$4,$5)', ['INSTITUTION_REGISTER','USER',user.rows[0].id,'PENDING',JSON.stringify({ wilayaId, dairaId, institutionId: institution.rows[0].id })]);
      await client.query('COMMIT');
      return reply.code(201).send({ account: user.rows[0], approval: 'pending_association_review' });
    } catch (error: any) { await client.query('ROLLBACK'); if (error?.code === '23505') return reply.code(409).send({ error: 'username_or_institution_code_exists' }); throw error; } finally { client.release(); }
  });
  app.get('/api/v1/auth/me', async (request, reply) => {
    const session = readSession(request.headers.authorization?.replace(/^Bearer\s+/i, ''));
    if (!session) return reply.code(401).send({ error: 'unauthorized' });
    return { user: session };
  });
  app.get('/api/v1/dashboard/summary', async (request, reply) => {
    const req = request as import('./http/auth-guard.js').AuthenticatedRequest;
    const { requireAuth } = await import('./http/auth-guard.js');
    if (!requireAuth(req, reply)) return;
    const { pool } = await import('./infrastructure/db.js');
    if (req.auth!.roles.some((role) => ['SYSTEM_ADMINISTRATOR','NATIONAL_ADMINISTRATOR'].includes(role))) {
      const result = await pool.query(`SELECT (SELECT count(*) FROM organizations WHERE archived_at IS NULL)::int AS organizations,(SELECT count(*) FROM educational_institutions WHERE archived_at IS NULL)::int AS institutions,(SELECT count(*) FROM participants WHERE archived_at IS NULL)::int AS participants,(SELECT count(*) FROM sports_licenses WHERE archived_at IS NULL)::int AS licenses`);
      return { scope: 'national', data: result.rows[0] };
    }
    if (req.auth!.dairaId !== undefined && req.auth!.dairaId !== null && req.auth!.roles.includes('DAIRA_OFFICER')) {
      const result = await pool.query(`SELECT (SELECT count(*) FROM educational_institutions WHERE daira_id=$1 AND archived_at IS NULL)::int AS institutions,(SELECT count(*) FROM participants p JOIN educational_institutions i ON i.id=p.institution_id WHERE i.daira_id=$1 AND p.archived_at IS NULL)::int AS participants,(SELECT count(*) FROM sports_licenses l JOIN participants p ON p.id=l.participant_id JOIN educational_institutions i ON i.id=p.institution_id WHERE i.daira_id=$1 AND l.archived_at IS NULL)::int AS licenses`, [req.auth!.dairaId]);
      return { scope: 'daira', data: result.rows[0] };
    }
    if (req.auth!.institutionId && req.auth!.roles.includes('MEMBER_INSTITUTION_USER')) {
      const result = await pool.query(`SELECT (SELECT count(*) FROM participants WHERE institution_id=$1 AND archived_at IS NULL)::int AS participants,(SELECT count(*) FROM sports_licenses l JOIN participants p ON p.id=l.participant_id WHERE p.institution_id=$1 AND l.archived_at IS NULL)::int AS licenses`, [req.auth.institutionId]);
      return { scope: 'institution', data: result.rows[0] };
    }
    if (req.auth!.organizationId) {
      const result = await pool.query(`SELECT (SELECT count(*) FROM educational_institutions WHERE organization_id=$1 AND archived_at IS NULL)::int AS institutions,(SELECT count(*) FROM participants p JOIN educational_institutions i ON i.id=p.institution_id WHERE i.organization_id=$1 AND p.archived_at IS NULL)::int AS participants,(SELECT count(*) FROM sports_licenses l JOIN participants p ON p.id=l.participant_id JOIN educational_institutions i ON i.id=p.institution_id WHERE i.organization_id=$1 AND l.archived_at IS NULL)::int AS licenses`, [req.auth.organizationId]);
      return { scope: 'organization', data: result.rows[0] };
    }
    return reply.code(403).send({ error: 'scope_not_configured' });
  });
  app.get('/api/v1/association/institution-registrations', async (request, reply) => {
    const req = request as import('./http/auth-guard.js').AuthenticatedRequest; const { requireAuth, hasPermission } = await import('./http/auth-guard.js');
    if (!requireAuth(req, reply)) return; if (!req.auth.wilayaId || !(await hasPermission(req, 'institution.approve'))) return reply.code(403).send({ error: 'forbidden' });
    const { pool } = await import('./infrastructure/db.js'); const result = await pool.query("SELECT u.id,u.username,u.display_name,u.status,u.created_at,i.name AS institution_name,i.code AS institution_code,d.name AS daira_name FROM users u JOIN educational_institutions i ON i.id=u.institution_id JOIN dairas d ON d.id=u.daira_id JOIN organizations o ON o.id=u.organization_id WHERE u.status='PENDING' AND o.wilaya_id=$1 ORDER BY u.created_at", [req.auth.wilayaId]);
    return { data: result.rows };
  });
  app.post('/api/v1/association/institution-registrations/:userId/approve', async (request, reply) => {
    const req = request as import('./http/auth-guard.js').AuthenticatedRequest; const { requireAuth, hasPermission } = await import('./http/auth-guard.js');
    if (!requireAuth(req, reply)) return; if (!req.auth.wilayaId || !(await hasPermission(req, 'institution.approve'))) return reply.code(403).send({ error: 'forbidden' });
    const userId = z.string().uuid().safeParse((request.params as { userId: string }).userId); if (!userId.success) return reply.code(400).send({ error: 'validation_error' });
    const { pool } = await import('./infrastructure/db.js'); const result = await pool.query("UPDATE users u SET status='ACTIVE',updated_at=now() FROM organizations o WHERE u.id=$1 AND u.organization_id=o.id AND o.wilaya_id=$2 AND u.status='PENDING' RETURNING u.id,u.username,u.status", [userId.data, req.auth.wilayaId]);
    if (!result.rowCount) return reply.code(404).send({ error: 'pending_registration_not_found' });
    await pool.query('INSERT INTO audit_logs(actor_user_id,action,entity_type,entity_id,result_status) VALUES($1,$2,$3,$4,$5)', [req.auth.userId, 'INSTITUTION_APPROVE', 'USER', userId.data, 'SUCCESS']); return { account: result.rows[0] };
  });
  app.post('/api/v1/auth/logout', async (request, reply) => { const session = readSession(request.headers.authorization?.replace(/^Bearer\s+/i, '')); if (!session) return reply.code(401).send({ error: 'unauthorized' }); const { pool } = await import('./infrastructure/db.js'); await pool.query('INSERT INTO audit_logs (actor_user_id, action, entity_type, entity_id, result_status) VALUES ($1,$2,$3,$4,$5)', [session.userId,'LOGOUT','AUTHENTICATION',session.userId,'SUCCESS']); return { success: true }; });
  app.post('/api/v1/auth/change-password', async (request, reply) => { const session=readSession(request.headers.authorization?.replace(/^Bearer\s+/i,'')); if(!session)return reply.code(401).send({error:'unauthorized'}); const parsed=z.object({currentPassword:z.string().min(12),newPassword:z.string().min(12).max(200)}).safeParse(request.body); if(!parsed.success)return reply.code(400).send({error:'validation_error'}); const {pool}=await import('./infrastructure/db.js'); const user=await pool.query('SELECT password_hash FROM users WHERE id=$1 AND status=\'ACTIVE\'',[session.userId]); if(!user.rowCount||!verifyPassword(parsed.data.currentPassword,user.rows[0].password_hash))return reply.code(401).send({error:'invalid_current_password'}); await pool.query('UPDATE users SET password_hash=$1,updated_at=now() WHERE id=$2',[encodePassword(parsed.data.newPassword),session.userId]); await pool.query('INSERT INTO audit_logs(actor_user_id,action,entity_type,entity_id,result_status) VALUES($1,$2,$3,$4,$5)',[session.userId,'CHANGE_PASSWORD','AUTHENTICATION',session.userId,'SUCCESS']); return {success:true}; });
  void registerAdminRoutes(app);
  void registerCompetitionRoutes(app);
  app.get('/api/v1/public/licenses/verify/:reference', { config: { rateLimit: { max: 30, timeWindow: '1 minute' } } }, async (request, reply) => {
    reply.header('cache-control', 'no-store');
    const parsed = z.object({ reference: z.string().min(20).max(200) }).safeParse(request.params);
    if (!parsed.success) return reply.code(400).send({ error: 'invalid_verification_reference' });
    let verification;
    try { verification = await verifyLicense(parsed.data.reference); } catch (error) { request.log.error(error); return reply.code(503).send({ error: 'verification_unavailable' }); }
    if (!verification) return reply.code(404).send({ error: 'license_not_found' });
    return { verified: true, ...verification };
  });
  const publicPage = (request: any) => { const page = Math.max(1, Math.min(10000, Number(request.query?.page ?? 1))); const pageSize = Math.max(1, Math.min(100, Number(request.query?.pageSize ?? 25))); return { page, pageSize, offset:(page-1)*pageSize }; };
  app.get('/api/v1/public/seasons', async (request) => { const {page,pageSize,offset}=publicPage(request); const query=z.object({status:z.enum(['ACTIVE','CLOSED']).optional()}).parse(request.query); const values:any[]=[]; const where=["archived_at IS NULL"]; if(query.status){values.push(query.status);where.push(`status=$${values.length}`)} else where.push("status IN ('ACTIVE','CLOSED')"); values.push(pageSize,offset); const result = await (await import('./infrastructure/db.js')).pool.query(`SELECT id,name,start_date,end_date,status FROM seasons WHERE ${where.join(' AND ')} ORDER BY start_date DESC LIMIT $${values.length-1} OFFSET $${values.length}` ,values); return { data: result.rows, page, pageSize }; });
  app.get('/api/v1/public/competitions', async (request) => { const {page,pageSize,offset}=publicPage(request); const query=z.object({seasonId:z.string().uuid().optional(),status:z.enum(['REGISTRATION','ACTIVE','RESULTS','CLOSED']).optional()}).parse(request.query); const values:any[]=[]; const where=['c.archived_at IS NULL','s.status IN (\'ACTIVE\',\'CLOSED\')']; if(query.seasonId){values.push(query.seasonId);where.push(`c.season_id=$${values.length}`)} if(query.status){values.push(query.status);where.push(`c.status=$${values.length}`)} else where.push("c.status IN ('REGISTRATION','ACTIVE','RESULTS','CLOSED')"); values.push(pageSize,offset); const result = await (await import('./infrastructure/db.js')).pool.query(`SELECT c.id,c.name,c.status,c.start_date,c.end_date,s.name AS season_name FROM competitions c JOIN seasons s ON s.id=c.season_id WHERE ${where.join(' AND ')} ORDER BY c.start_date DESC NULLS LAST LIMIT $${values.length-1} OFFSET $${values.length}` ,values); return { data: result.rows, page, pageSize }; });
  app.get('/api/v1/public/results', async (request) => { const {page,pageSize,offset}=publicPage(request); const query=z.object({competitionId:z.string().uuid().optional(),seasonId:z.string().uuid().optional()}).parse(request.query); const values:any[]=[]; const where=["r.status='ACTIVE'","c.status IN ('RESULTS','CLOSED')",'r.archived_at IS NULL']; if(query.competitionId){values.push(query.competitionId);where.push(`r.competition_id=$${values.length}`)} if(query.seasonId){values.push(query.seasonId);where.push(`c.season_id=$${values.length}`)} values.push(pageSize,offset); const result = await (await import('./infrastructure/db.js')).pool.query(`SELECT c.name AS competition_name,s.name AS season_name,r.created_at FROM results r JOIN competitions c ON c.id=r.competition_id JOIN seasons s ON s.id=c.season_id WHERE ${where.join(' AND ')} ORDER BY r.created_at DESC LIMIT $${values.length-1} OFFSET $${values.length}` ,values); return { data: result.rows, page, pageSize }; });
  app.get('/api/v1/public/geography/wilayas', async () => { const { pool } = await import('./infrastructure/db.js'); const result = await pool.query('SELECT id,name,ar_name FROM wilayas ORDER BY id'); return { data: result.rows }; });
  app.get('/api/v1/public/geography/wilayas/:id/dairas', async (request, reply) => { const id=z.coerce.number().int().min(1).max(58).safeParse((request.params as {id:string}).id); if(!id.success)return reply.code(400).send({error:'validation_error'}); const { pool } = await import('./infrastructure/db.js'); const result = await pool.query('SELECT id,wilaya_id,name,ar_name FROM dairas WHERE wilaya_id=$1 ORDER BY name',[id.data]); return { data: result.rows }; });
  app.get('/api/v1/public/geography/dairas/:id/communes', async (request, reply) => { const id=z.coerce.number().int().nonnegative().safeParse((request.params as {id:string}).id); if(!id.success)return reply.code(400).send({error:'validation_error'}); const { pool } = await import('./infrastructure/db.js'); const result = await pool.query('SELECT id,daira_id,wilaya_id,name,ar_name FROM communes WHERE daira_id=$1 ORDER BY name',[id.data]); return { data: result.rows }; });
  return app;
}
