import { createHmac, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { pool } from '../infrastructure/db.js';
import { config } from '../config.js';

const secret = () => config.authSecret;
export function encodePassword(password: string): string { const salt = randomBytes(16).toString('hex'); return `scrypt$${salt}$${scryptSync(password,salt,64).toString('hex')}`; }
export function verifyPassword(password: string, encoded: string | null): boolean {
  if (!encoded?.startsWith('scrypt$')) return false;
  const [, salt, expected] = encoded.split('$');
  if (!salt || !expected || expected.length !== 128) return false;
  const actual = scryptSync(password, salt, 64).toString('hex');
  return timingSafeEqual(Buffer.from(actual), Buffer.from(expected));
}
function sign(payload: object): string {
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return `${body}.${createHmac('sha256', secret()).update(body).digest('base64url')}`;
}
export function readSession(token: string | undefined): { userId: string; username: string; roles: string[]; organizationId?: string; institutionId?: string; dairaId?: string; wilayaId?: string } | null {
  if (!token) return null;
  const [body, signature] = token.split('.');
  if (!body || !signature) return null;
  const expected = createHmac('sha256', secret()).update(body).digest('base64url');
  if (signature.length !== expected.length || !timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) return null;
  try { const data = JSON.parse(Buffer.from(body, 'base64url').toString()) as { userId:string; username:string; roles:string[]; exp:number }; return data.exp > Date.now() ? data : null; } catch { return null; }
}
export async function login(username: string, password: string) {
  const result = await pool.query(`SELECT u.id, u.username, u.password_hash, u.status, u.organization_id, u.institution_id, u.daira_id, o.wilaya_id, COALESCE(array_agg(r.name) FILTER (WHERE r.name IS NOT NULL), '{}') AS roles FROM users u LEFT JOIN organizations o ON o.id=u.organization_id LEFT JOIN user_roles ur ON ur.user_id=u.id LEFT JOIN roles r ON r.id=ur.role_id WHERE u.username=$1 GROUP BY u.id,o.wilaya_id`, [username]);
  const user = result.rows[0] as {id:string;username:string;password_hash:string|null;status:string;roles:string[];organization_id?:string;institution_id?:string;daira_id?:string;wilaya_id?:string} | undefined;
  if (!user || user.status !== 'ACTIVE' || !verifyPassword(password, user.password_hash)) {
    await pool.query('INSERT INTO audit_logs (action, entity_type, result_status, metadata) VALUES ($1,$2,$3,$4)', ['LOGIN','AUTHENTICATION','FAILURE',JSON.stringify({ username })]);
    return null;
  }
  await pool.query('INSERT INTO audit_logs (actor_user_id, action, entity_type, entity_id, result_status, metadata) VALUES ($1,$2,$3,$4,$5,$6)', [user.id,'LOGIN','AUTHENTICATION',user.id,'SUCCESS',JSON.stringify({ username })]);
  const scope = { organizationId: user.organization_id, institutionId: user.institution_id, dairaId: user.daira_id, wilayaId: user.wilaya_id };
  return { user: { id: user.id, username: user.username, roles: user.roles, ...scope }, token: sign({ userId: user.id, username: user.username, roles: user.roles, ...scope, exp: Date.now() + 8 * 60 * 60 * 1000 }) };
}
