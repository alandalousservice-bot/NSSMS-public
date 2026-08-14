import { createHash, randomBytes } from 'node:crypto';
import { pool } from '../infrastructure/db.js';

export function hashVerificationReference(reference: string): string { return createHash('sha256').update(reference, 'utf8').digest('hex'); }
export function createVerificationReference(): string { return randomBytes(32).toString('base64url'); }

export async function verifyLicense(reference: string) {
  const hash = hashVerificationReference(reference);
  const result = await pool.query(`SELECT l.id, l.status, l.issued_at, l.expires_at FROM qr_verifications q JOIN sports_licenses l ON l.id=q.license_id WHERE q.reference_hash=$1 AND q.revoked_at IS NULL`, [hash]);
  if (!result.rowCount) return null;
  const row = result.rows[0] as {id:string; status:string; issued_at:string|null; expires_at:string|null};
  const expired = row.expires_at ? new Date(row.expires_at).getTime() <= Date.now() : false;
  return { status: expired && row.status === 'ACTIVE' ? 'EXPIRED' : row.status, issuedAt: row.issued_at, expiresAt: row.expires_at };
}
