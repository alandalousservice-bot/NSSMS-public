import { FastifyReply, FastifyRequest } from 'fastify';
import { readSession } from '../services/auth.js';
import { pool } from '../infrastructure/db.js';
export type AuthenticatedRequest = FastifyRequest & { auth: { userId:string; username:string; roles:string[]; organizationId?:string; institutionId?:string; dairaId?:string; wilayaId?:string } };
export function requireAuth(request: AuthenticatedRequest, reply: FastifyReply): boolean {
  const session = readSession(request.headers.authorization?.replace(/^Bearer\s+/i, ''));
  if (!session) { void reply.code(401).send({ error: 'unauthorized' }); return false; }
  request.auth = session; return true;
}
export function hasRole(request: AuthenticatedRequest, roles: string[]): boolean { return Boolean(request.auth?.roles.some((role) => roles.includes(role))); }
export async function hasPermission(request: AuthenticatedRequest, permission: string): Promise<boolean> { if (!request.auth) return false; const result = await pool.query('SELECT 1 FROM user_roles ur JOIN role_permissions rp ON rp.role_id=ur.role_id JOIN permissions p ON p.id=rp.permission_id WHERE ur.user_id=$1 AND p.key=$2 LIMIT 1',[request.auth.userId,permission]); return Boolean(result.rowCount); }
export async function recordAccessDenied(request: AuthenticatedRequest, action: string, entityType = 'AUTHORIZATION'): Promise<void> { if (request.auth) await pool.query('INSERT INTO audit_logs(actor_user_id,action,entity_type,result_status,metadata) VALUES($1,$2,$3,$4,$5)',[request.auth.userId,action,entityType,'DENIED',JSON.stringify({ path: request.url })]); }
