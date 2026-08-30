import Fastify, { LogController, type FastifyBaseLogger } from 'fastify';
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
import { scopeKind } from './http/auth-guard.js';

export function buildApp(options: { loggerInstance?: FastifyBaseLogger } = {}) {
  const app = Fastify({ loggerInstance: options.loggerInstance, logger: options.loggerInstance ? undefined : { level: process.env.LOG_LEVEL ?? 'info' }, logController: new LogController({ disableRequestLogging: true }), genReqId: () => randomUUID(), requestTimeout: config.requestTimeoutMs, bodyLimit: config.bodyLimit, trustProxy: config.trustProxy });
  app.addHook('onRequest', async (request, reply) => { reply.header('x-request-id', request.id); if (request.headers.authorization) reply.header('cache-control', 'private, no-store'); });
  const errorBody = (requestId: string, code: string, message: string) => ({ error: { code, message, request_id: requestId } });
  app.setErrorHandler((error, request, reply) => { const err = error as { statusCode?: number; code?: string; name?: string }; const status = err.statusCode && err.statusCode < 500 ? err.statusCode : 500; const code = status === 429 ? 'RATE_LIMITED' : status === 401 ? 'UNAUTHORIZED' : status === 403 ? 'FORBIDDEN' : status === 404 ? 'NOT_FOUND' : status === 400 || status === 413 || status === 422 ? 'VALIDATION_ERROR' : 'INTERNAL_ERROR'; (request as typeof request & { errorCode?: string }).errorCode = code; request.log.error({ request_id: request.id, error_code: code, error_category: err.code ?? err.name ?? 'unhandled' }, 'request failed'); return reply.code(status).send(errorBody(request.id, code, code === 'INTERNAL_ERROR' ? 'An internal error occurred' : 'The request could not be completed')); });
  app.addHook('onResponse', async (request, reply) => {
    const auth = (request as typeof request & { auth?: { userId: string; institutionId?: string; dairaId?: string; organizationId?: string } }).auth;
    const scopeId = auth?.institutionId ?? auth?.dairaId ?? auth?.organizationId;
    const path = request.routeOptions.url ?? request.url.split('?')[0];
    const objectType = path.includes('competition-entries') ? 'competition_entry' : path.includes('competition-results') ? 'competition_result' : path.includes('qualifications') ? 'qualification' : path.includes('rankings') ? 'ranking' : path.includes('awards') ? 'award' : undefined;
    const objectId = (request.params as { id?: string } | undefined)?.id;
    request.log.info({ request_id: request.id, method: request.method, route: path, status: reply.statusCode, duration_ms: Math.round(reply.elapsedTime), user_id: auth?.userId, scope_type: auth ? scopeKind(request as never) : undefined, scope_id: scopeId, object_type: objectType, object_id: objectId, error_code: (request as typeof request & { errorCode?: string }).errorCode }, 'request completed');
  });
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
  app.post('/api/v1/auth/login', { config: { rateLimit: { max: config.authRateLimitMax, timeWindow: config.rateLimitWindow } } }, async (request, reply) => {
    const parsed = z.object({ username: z.string().min(3).max(100), password: z.string().min(12).max(200) }).safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ error: 'invalid_credentials' });
    const result = await login(parsed.data.username, parsed.data.password);
    if (!result) return reply.code(401).send({ error: 'invalid_credentials' });
    return result;
  });
  app.post('/api/v1/auth/institution-register', { config: { rateLimit: { max: config.registrationRateLimitMax, timeWindow: config.rateLimitWindow } } }, async (request, reply) => {
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
  app.get('/api/v1/public/results', async (request) => { const {page,pageSize,offset}=publicPage(request); const query=z.object({competitionId:z.string().uuid().optional(),seasonId:z.string().uuid().optional()}).parse(request.query); const values:any[]=[]; const where=["r.governed_status='VALIDATED'","c.status IN ('RESULTS','CLOSED')",'r.archived_at IS NULL','c.archived_at IS NULL','s.archived_at IS NULL','current_decision.id IS NOT NULL']; if(query.competitionId){values.push(query.competitionId);where.push(`r.competition_id=$${values.length}`)} if(query.seasonId){values.push(query.seasonId);where.push(`c.season_id=$${values.length}`)} values.push(pageSize,offset); const result = await (await import('./infrastructure/db.js')).pool.query(`SELECT r.id, c.name AS competition_name, s.name AS season_name, cs.stage_level_code, ev.name AS event_name, cat.name AS category_name, occ.start_at AS held_at, ce.entry_type, CASE WHEN te.id IS NOT NULL THEN te.name ELSE i.name END AS competitor_name, official.position AS position, official.points AS points, current_decision.decided_at AS published_at FROM results r JOIN competitions c ON c.id=r.competition_id JOIN seasons s ON s.id=c.season_id JOIN competition_stages cs ON cs.id=r.stage_id JOIN calendar_occurrences occ ON occ.id=r.occurrence_id JOIN events ev ON ev.id=r.event_id JOIN categories cat ON cat.id=r.category_id JOIN competition_entries ce ON ce.id=r.competition_entry_id LEFT JOIN educational_institutions i ON i.id=ce.institution_id LEFT JOIN team_entries team_link ON team_link.competition_entry_id=ce.id LEFT JOIN teams te ON te.id=team_link.team_id LEFT JOIN LATERAL (SELECT cd.* FROM result_validations cd WHERE cd.result_id=r.id AND cd.decision='VALIDATED' AND NOT EXISTS (SELECT 1 FROM result_validations superseding WHERE superseding.supersedes_validation_id=cd.id) AND cd.revision_no=(SELECT COALESCE(MAX(latest.revision_no),0) FROM result_revisions latest WHERE latest.result_id=r.id) ORDER BY cd.created_at DESC, cd.id DESC LIMIT 1) current_decision ON true LEFT JOIN LATERAL (SELECT rw.position::int AS position, rw.points AS points FROM rankings ranked JOIN ranking_rows rw ON rw.ranking_id=ranked.id AND rw.competition_entry_id=r.competition_entry_id WHERE ranked.stage_id=r.stage_id AND ranked.event_id=r.event_id AND ranked.category_id=r.category_id AND ranked.status IN ('VALIDATED','PUBLISHED') AND ranked.archived_at IS NULL AND NOT EXISTS (SELECT 1 FROM rankings successor WHERE successor.supersedes_ranking_id=ranked.id) LIMIT 1) official ON true WHERE ${where.join(' AND ')} ORDER BY current_decision.decided_at DESC, r.id DESC LIMIT $${values.length-1} OFFSET $${values.length}` ,values); return { data: result.rows.map((row:any)=>({ id:row.id, competition_name:row.competition_name, season_name:row.season_name, stage_level_code:row.stage_level_code, event_name:row.event_name, category_name:row.category_name, held_at:row.held_at, entry_type:row.entry_type, competitor_name:row.competitor_name ?? null, position:row.position ?? null, points:row.points==null?null:Number(row.points), status:'OFFICIAL', published_at:row.published_at })), page, pageSize }; });
  app.get('/api/v1/public/awards', async (request) => { const {page,pageSize,offset}=publicPage(request); const query=z.object({competitionId:z.string().uuid().optional(),seasonId:z.string().uuid().optional()}).parse(request.query); const values:any[]=[]; const where=["a.status='ISSUED'",'a.archived_at IS NULL','c.archived_at IS NULL','s.archived_at IS NULL']; if(query.competitionId){values.push(query.competitionId);where.push(`c.id=$${values.length}`)} if(query.seasonId){values.push(query.seasonId);where.push(`c.season_id=$${values.length}`)} values.push(pageSize,offset); const result = await (await import('./infrastructure/db.js')).pool.query(`SELECT a.id, a.award_type, a.label, a.issued_at, ranked.ranking_type, CASE WHEN ranked.id IS NOT NULL THEN ranked.calculation_version ELSE NULL END AS calculation_version, c.id AS competition_id, c.name AS competition_name, s.name AS season_name, cs.stage_level_code, cat.name AS category_name, ev.name AS event_name, CASE WHEN te.id IS NOT NULL THEN te.name ELSE i.name END AS competitor_name FROM awards a JOIN competition_entries ce ON ce.id=a.competition_entry_id JOIN competition_stages cs ON cs.id=ce.stage_id JOIN competitions c ON c.id=cs.competition_id JOIN seasons s ON s.id=c.season_id LEFT JOIN categories cat ON cat.id=ce.category_id LEFT JOIN educational_institutions i ON i.id=ce.institution_id LEFT JOIN team_entries team_link ON team_link.competition_entry_id=ce.id LEFT JOIN teams te ON te.id=team_link.team_id LEFT JOIN rankings ranked ON ranked.id=a.ranking_id LEFT JOIN events ev ON ev.id=ranked.event_id WHERE ${where.join(' AND ')} ORDER BY a.issued_at DESC NULLS LAST, a.created_at DESC LIMIT $${values.length-1} OFFSET $${values.length}` ,values); return { data: result.rows.map((row:any)=>({ id:row.id, award_type:row.award_type, label:row.label ?? null, status:'ISSUED', issued_at:row.issued_at, ranking_type:row.ranking_type ?? null, calculation_version:row.calculation_version, competition_id:row.competition_id, competition_name:row.competition_name, season_name:row.season_name, stage_level_code:row.stage_level_code, category_name:row.category_name ?? null, event_name:row.event_name ?? null, competitor_name:row.competitor_name ?? null, source:'OFFICIAL' })), page, pageSize }; });
  app.get('/api/v1/public/records', async (request) => { const {page,pageSize,offset}=publicPage(request); const query=z.object({competitionId:z.string().uuid().optional(),seasonId:z.string().uuid().optional(),stageId:z.string().uuid().optional(),rankingType:z.enum(['EVENT','CATEGORY','STAGE']).optional()}).parse(request.query); const values:any[]=[]; const where=["rk.status IN ('VALIDATED','PUBLISHED')",'rk.archived_at IS NULL','NOT EXISTS (SELECT 1 FROM rankings successor WHERE successor.supersedes_ranking_id=rk.id)','c.archived_at IS NULL','s.archived_at IS NULL']; if(query.competitionId){values.push(query.competitionId);where.push(`c.id=$${values.length}`)} if(query.seasonId){values.push(query.seasonId);where.push(`c.season_id=$${values.length}`)} if(query.stageId){values.push(query.stageId);where.push(`rk.stage_id=$${values.length}`)} if(query.rankingType){values.push(query.rankingType);where.push(`rk.ranking_type=$${values.length}`)} values.push(pageSize,offset); const result = await (await import('./infrastructure/db.js')).pool.query(`SELECT rk.id, rk.ranking_type, rk.status, rk.calculation_version, c.id AS competition_id, c.name AS competition_name, s.name AS season_name, cs.stage_level_code, ev.name AS event_name, cat.name AS category_name, rk.created_at AS recognized_at FROM rankings rk JOIN competition_stages cs ON cs.id=rk.stage_id JOIN competitions c ON c.id=cs.competition_id JOIN seasons s ON s.id=c.season_id LEFT JOIN events ev ON ev.id=rk.event_id LEFT JOIN categories cat ON cat.id=rk.category_id WHERE ${where.join(' AND ')} ORDER BY c.start_date DESC NULLS LAST, rk.created_at DESC LIMIT $${values.length-1} OFFSET $${values.length}` ,values); return { data: result.rows.map((row:any)=>({ id:row.id, ranking_type:row.ranking_type, status:row.status, calculation_version:row.calculation_version, competition_id:row.competition_id, competition_name:row.competition_name, season_name:row.season_name, stage_level_code:row.stage_level_code, event_name:row.event_name ?? null, category_name:row.category_name ?? null, source:'OFFICIAL', recognized_at:row.recognized_at })), page, pageSize }; });
  app.get('/api/v1/public/geography/wilayas', async () => { const { pool } = await import('./infrastructure/db.js'); const result = await pool.query('SELECT id,name,ar_name FROM wilayas ORDER BY id'); return { data: result.rows }; });
  app.get('/api/v1/public/geography/wilayas/:id/dairas', async (request, reply) => { const id=z.coerce.number().int().min(1).max(58).safeParse((request.params as {id:string}).id); if(!id.success)return reply.code(400).send({error:'validation_error'}); const { pool } = await import('./infrastructure/db.js'); const result = await pool.query('SELECT id,wilaya_id,name,ar_name FROM dairas WHERE wilaya_id=$1 ORDER BY name',[id.data]); return { data: result.rows }; });
  app.get('/api/v1/public/geography/dairas/:id/communes', async (request, reply) => { const id=z.coerce.number().int().nonnegative().safeParse((request.params as {id:string}).id); if(!id.success)return reply.code(400).send({error:'validation_error'}); const { pool } = await import('./infrastructure/db.js'); const result = await pool.query('SELECT id,daira_id,wilaya_id,name,ar_name FROM communes WHERE daira_id=$1 ORDER BY name',[id.data]); return { data: result.rows }; });
  return app;
}
