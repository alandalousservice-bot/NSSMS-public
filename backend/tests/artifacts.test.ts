import { describe, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

describe('delivery artifacts', () => {
  it('contains valid OpenAPI JSON with the versioned API metadata', async () => {
    const document = JSON.parse(await readFile(resolve(process.cwd(), 'openapi.json'), 'utf8')) as { openapi:string; paths:Record<string,unknown> };
    expect(document.openapi).toBe('3.0.3');
    expect(document.paths['/api/v1/auth/login']).toBeDefined();
    expect(document.paths['/api/v1/auth/me']).toBeDefined();
    expect((document.paths['/api/v1/auth/me'] as any).get.security).toEqual([{ bearerAuth: [] }]);
    expect(document.paths['/api/v1/admin/reports/status-breakdown']).toBeDefined();
    expect(document.paths['/api/v1/public/licenses/verify/{reference}']).toBeDefined();
  });
  it('keeps demo account seeding idempotent', async () => {
    const source = await readFile(resolve(process.cwd(), 'scripts/create-demo-accounts.mjs'), 'utf8');
    expect(source).toContain('ON CONFLICT (username) DO UPDATE');
    expect(source).toContain('ON CONFLICT DO NOTHING');
  });
  it('defines scoped account roles and seed behavior', async () => {
    const migration = await readFile(resolve(process.cwd(), '../database/migrations/005_scoped_account_roles.sql'), 'utf8');
    const seed = await readFile(resolve(process.cwd(), 'scripts/create-scoped-accounts.mjs'), 'utf8');
    expect(migration).toContain('ASSOCIATION_ADMINISTRATOR');
    expect(migration).toContain('MEMBER_INSTITUTION_USER');
    expect(seed).toContain('ON CONFLICT(username) DO UPDATE');
  });
  it('defines Algerian geography import artifacts', async () => {
    const migration = await readFile(resolve(process.cwd(), '../database/migrations/006_algerian_geography.sql'), 'utf8');
    const importer = await readFile(resolve(process.cwd(), 'scripts/import-geography.mjs'), 'utf8');
    expect(migration).toContain('CREATE TABLE IF NOT EXISTS wilayas');
    expect(migration).toContain('CREATE TABLE IF NOT EXISTS dairas');
    expect(migration).toContain('CREATE TABLE IF NOT EXISTS communes');
    expect(importer).toContain('Imported');
  });
});
