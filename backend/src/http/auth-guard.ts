import { FastifyReply, FastifyRequest } from 'fastify';
import { readSession } from '../services/auth.js';
import { pool } from '../infrastructure/db.js';
export type AuthenticatedRequest = FastifyRequest & { auth: { userId:string; username:string; roles:string[]; organizationId?:string; institutionId?:string; dairaId?:string; wilayaId?:string } };
export type ScopedResource = 'organization'|'institution'|'participant'|'license'|'result'|'user';
export type ScopeKind = 'national'|'organization'|'daira'|'institution'|'unscoped';
export function scopeKind(request: AuthenticatedRequest): ScopeKind {
  if (request.auth?.roles.some((role) => ['SYSTEM_ADMINISTRATOR', 'NATIONAL_ADMINISTRATOR'].includes(role))) return 'national';
  if (request.auth?.roles.includes('MEMBER_INSTITUTION_USER') && request.auth.institutionId) return 'institution';
  if (request.auth?.roles.includes('DAIRA_OFFICER') && request.auth.dairaId) return 'daira';
  if (request.auth?.roles.some((role) => ['ASSOCIATION_ADMINISTRATOR', 'ASSOCIATION_REPRESENTATIVE'].includes(role)) && request.auth.organizationId) return 'organization';
  return 'unscoped';
}
export function requireAuth(request: AuthenticatedRequest, reply: FastifyReply): boolean {
  const session = readSession(request.headers.authorization?.replace(/^Bearer\s+/i, ''));
  if (!session) { void reply.code(401).send({ error: 'unauthorized' }); return false; }
  request.auth = session; return true;
}
export function hasRole(request: AuthenticatedRequest, roles: string[]): boolean { return Boolean(request.auth?.roles.some((role) => roles.includes(role))); }
export async function hasPermission(request: AuthenticatedRequest, permission: string): Promise<boolean> { if (!request.auth) return false; const result = await pool.query('SELECT 1 FROM user_roles ur JOIN role_permissions rp ON rp.role_id=ur.role_id JOIN permissions p ON p.id=rp.permission_id WHERE ur.user_id=$1 AND p.key=$2 LIMIT 1',[request.auth.userId,permission]); return Boolean(result.rowCount); }
export async function recordAccessDenied(request: AuthenticatedRequest, action: string, entityType = 'AUTHORIZATION'): Promise<void> { if (request.auth) await pool.query('INSERT INTO audit_logs(actor_user_id,action,entity_type,result_status,metadata) VALUES($1,$2,$3,$4,$5)',[request.auth.userId,action,entityType,'DENIED',JSON.stringify({ path: request.url })]); }

export function scopeCondition(request: AuthenticatedRequest, resource: ScopedResource, alias: string, parameter = 1): { sql: string; values: string[] } {
  const kind = scopeKind(request); const auth = request.auth;
  if (kind === 'national') return { sql: 'TRUE', values: [] };
  if (kind === 'unscoped') return { sql: 'FALSE', values: [] };
  if (resource === 'organization') {
    if (kind === 'organization') return { sql: `${alias}.id = $${parameter}`, values: [auth.organizationId!] };
    return { sql: `${alias}.wilaya_id = (SELECT wilaya_id FROM dairas WHERE id = $${parameter})`, values: [auth.dairaId!] };
  }
  if (resource === 'institution') {
    if (kind === 'institution') return { sql: `${alias}.id = $${parameter}`, values: [auth.institutionId!] };
    if (kind === 'daira') return { sql: `${alias}.daira_id = $${parameter}`, values: [auth.dairaId!] };
    return { sql: `${alias}.organization_id = $${parameter}`, values: [auth.organizationId!] };
  }
  if (resource === 'participant') {
    const institution = scopeCondition(request, 'institution', 'i', parameter);
    return { sql: `EXISTS (SELECT 1 FROM educational_institutions i WHERE i.id = ${alias}.institution_id AND ${institution.sql})`, values: institution.values };
  }
  if (resource === 'license') {
    const participant = scopeCondition(request, 'participant', 'p', parameter);
    return { sql: `EXISTS (SELECT 1 FROM participants p WHERE p.id = ${alias}.participant_id AND ${participant.sql})`, values: participant.values };
  }
  if (resource === 'result') {
    const participant = scopeCondition(request, 'participant', 'p', parameter);
    return { sql: `EXISTS (SELECT 1 FROM participants p WHERE p.id = ${alias}.participant_id AND ${participant.sql})`, values: participant.values };
  }
  if (kind === 'institution') return { sql: `${alias}.id = $${parameter}`, values: [auth.userId] };
  if (kind === 'daira') return { sql: `${alias}.daira_id = $${parameter}`, values: [auth.dairaId!] };
  return { sql: `${alias}.organization_id = $${parameter}`, values: [auth.organizationId!] };
}

export async function requirePolicy(request: AuthenticatedRequest, reply: FastifyReply, options: { roles?: string[]; permission?: string; resource?: ScopedResource }): Promise<boolean> {
  if (!requireAuth(request, reply)) return false;
  if (options.roles?.length && !hasRole(request, options.roles)) { await recordAccessDenied(request, 'ROLE_DENIED'); void reply.code(403).send({ error: 'forbidden' }); return false; }
  if (options.permission && !(await hasPermission(request, options.permission))) { await recordAccessDenied(request, 'PERMISSION_DENIED'); void reply.code(403).send({ error: 'forbidden' }); return false; }
  if (options.resource && scopeKind(request) !== 'national') {
    const allowedRoles = options.resource === 'organization' ? ['ASSOCIATION_ADMINISTRATOR', 'ASSOCIATION_REPRESENTATIVE'] : ['ASSOCIATION_ADMINISTRATOR', 'ASSOCIATION_REPRESENTATIVE', 'DAIRA_OFFICER', 'MEMBER_INSTITUTION_USER'];
    if (!hasRole(request, allowedRoles)) { await recordAccessDenied(request, 'RESOURCE_ROLE_DENIED', options.resource.toUpperCase()); void reply.code(403).send({ error: 'forbidden' }); return false; }
  }
  if (options.resource && scopeKind(request) === 'unscoped') { await recordAccessDenied(request, 'SCOPE_DENIED'); void reply.code(403).send({ error: 'forbidden' }); return false; }
  return true;
}

export async function canAccessResource(request: AuthenticatedRequest, resource: ScopedResource, id: string): Promise<boolean> {
  const tables: Record<ScopedResource, string> = { organization: 'organizations', institution: 'educational_institutions', participant: 'participants', license: 'sports_licenses', result: 'results', user: 'users' };
  const condition = scopeCondition(request, resource, 'r', 2);
  const result = await pool.query(`SELECT 1 FROM ${tables[resource]} r WHERE r.id=$1 AND ${condition.sql} LIMIT 1`, [id, ...condition.values]);
  return Boolean(result.rowCount);
}
export type CompetitionScopedResource='competition_entry'|'competition_result'|'qualification'|'ranking'|'award'|'competition_team'|'competition_stage';
export function stageEligibilityCondition(request: AuthenticatedRequest, stageAlias: string, parameter = 1): { sql: string; values: string[] } {
  const kind = scopeKind(request);
  if (kind === 'national') return { sql: 'TRUE', values: [] };
  if (kind === 'organization') return { sql: `EXISTS (SELECT 1 FROM competition_stage_scope_eligibility eligibility WHERE eligibility.stage_id=${stageAlias}.id AND eligibility.scope_type='ORGANIZATION' AND eligibility.organization_id=$${parameter})`, values: [request.auth.organizationId!] };
  if (kind === 'daira') return { sql: `EXISTS (SELECT 1 FROM competition_stage_scope_eligibility eligibility WHERE eligibility.stage_id=${stageAlias}.id AND eligibility.scope_type='DAIRA' AND eligibility.daira_id=$${parameter})`, values: [request.auth.dairaId!] };
  if (kind === 'institution') return { sql: `EXISTS (SELECT 1 FROM competition_stage_scope_eligibility eligibility WHERE eligibility.stage_id=${stageAlias}.id AND eligibility.scope_type='INSTITUTION' AND eligibility.institution_id=$${parameter})`, values: [request.auth.institutionId!] };
  return { sql: 'FALSE', values: [] };
}
export async function canDiscoverCompetitionStage(request: AuthenticatedRequest, id: string): Promise<boolean> {
  const condition = stageEligibilityCondition(request, 's', 2);
  return Boolean((await pool.query(`SELECT 1 FROM competition_stages s WHERE s.id=$1 AND ${condition.sql} LIMIT 1`, [id, ...condition.values])).rowCount);
}
export async function canAccessCompetitionResource(request:AuthenticatedRequest,resource:CompetitionScopedResource,id:string):Promise<boolean>{
  const condition=scopeCondition(request,'institution','i',2); const source:Record<CompetitionScopedResource,string>={
    competition_entry:'competition_entries e join educational_institutions i on i.id=e.institution_id',
    competition_result:'results r join competition_entries e on e.id=r.competition_entry_id join educational_institutions i on i.id=e.institution_id',
    qualification:'qualifications q join competition_entries e on e.id=q.source_entry_id join educational_institutions i on i.id=e.institution_id',
    ranking:'rankings r join competition_entries e on e.stage_id=r.stage_id join educational_institutions i on i.id=e.institution_id',
    award:'awards a join competition_entries e on e.id=a.competition_entry_id join educational_institutions i on i.id=e.institution_id',
    competition_team:'teams t join educational_institutions i on i.id=t.institution_id',
    competition_stage:'competition_stages s join competition_entries e on e.stage_id=s.id join educational_institutions i on i.id=e.institution_id'
  }; const alias=resource==='competition_entry'?'e':resource==='competition_result'?'r':resource==='qualification'?'q':resource==='ranking'?'r':resource==='award'?'a':resource==='competition_stage'?'s':'t';
  if(scopeKind(request)==='national')return competitionResourceExists(resource,id);
  const row=await pool.query(`select 1 from ${source[resource]} where ${alias}.id=$1 and ${condition.sql} limit 1`,[id,...condition.values]);return Boolean(row.rowCount);
}


export async function competitionResourceExists(resource:CompetitionScopedResource,id:string):Promise<boolean>{const source:Record<CompetitionScopedResource,string>={competition_entry:'competition_entries e',competition_result:'results r',qualification:'qualifications q',ranking:'rankings r',award:'awards a',competition_team:'teams t',competition_stage:'competition_stages s'},alias=resource==='competition_entry'?'e':resource==='competition_result'?'r':resource==='qualification'?'q':resource==='ranking'?'r':resource==='award'?'a':resource==='competition_stage'?'s':'t';return Boolean((await pool.query(`select 1 from ${source[resource]} where ${alias}.id=$1 limit 1`,[id])).rowCount)}
