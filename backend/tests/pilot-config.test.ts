import { afterAll, describe, expect, it, vi } from 'vitest';
import { buildApp } from '../src/app.js';

function noLeak(response: { body: string }) {
  expect(response.body).not.toMatch(/postgres|sql|constraint|trigger|plpgsql|stack|driver|detail|nssms_/i);
}

type EnvPatch = Record<string, string | undefined>;

async function loadConfig(patch: EnvPatch) {
  vi.resetModules();
  const saved = { ...process.env };
  try {
    for (const key of ['NODE_ENV','AUTH_SECRET','DATABASE_URL','CORS_ALLOWED_ORIGINS','CORS_ORIGINS','FRONTEND_ORIGIN','REQUEST_TIMEOUT_MS','BODY_LIMIT_BYTES']) delete process.env[key];
    for (const [key, value] of Object.entries(patch)) if (value !== undefined) process.env[key] = value;
    return await import('../src/config.js');
  } finally { process.env = saved; }
}

const strongSecret = 'pilot-hardening-strong-secret-value-0000000000000000';
const productionBase = { NODE_ENV: 'production', DATABASE_URL: 'postgres://pilot:pilot@localhost:5432/pilot', CORS_ALLOWED_ORIGINS: 'https://pilot.example.org', AUTH_SECRET: strongSecret };

describe('PILOT-HARDENING-001 configuration contract', () => {
  it('loads configurable request timeout and body limit with safe defaults', async () => {
    const defaults = await loadConfig({});
    expect(defaults.config.requestTimeoutMs).toBe(30000);
    expect(defaults.config.bodyLimit).toBe(1048576);
    const tuned = await loadConfig({ REQUEST_TIMEOUT_MS: '45000', BODY_LIMIT_BYTES: '262144' });
    expect(tuned.config.requestTimeoutMs).toBe(45000);
    expect(tuned.config.bodyLimit).toBe(262144);
    await expect(loadConfig({ REQUEST_TIMEOUT_MS: '-5' })).rejects.toThrow(/REQUEST_TIMEOUT_MS/);
    await expect(loadConfig({ REQUEST_TIMEOUT_MS: 'abc' })).rejects.toThrow(/REQUEST_TIMEOUT_MS/);
    await expect(loadConfig({ BODY_LIMIT_BYTES: '0' })).rejects.toThrow(/BODY_LIMIT_BYTES/);
  });

  it('wires timeout and body limit into the Fastify server instance', async () => {
    const app = buildApp();
    expect(app.initialConfig.requestTimeout).toBe(process.env.REQUEST_TIMEOUT_MS ? Number(process.env.REQUEST_TIMEOUT_MS) : 30000);
    expect(app.initialConfig.bodyLimit).toBe(process.env.BODY_LIMIT_BYTES ? Number(process.env.BODY_LIMIT_BYTES) : 1048576);
    await app.close();
  });

  it('keeps an isolated development fallback while production requires an explicit safe AUTH_SECRET', async () => {
    const development = await loadConfig({ NODE_ENV: undefined, AUTH_SECRET: undefined });
    expect(development.config.authSecret.length).toBeGreaterThan(0);

    await expect(loadConfig({ ...productionBase, AUTH_SECRET: undefined })).rejects.toThrow(/AUTH_SECRET is required/);
    const shortSecret = 'tooshort0000001';
    await expect(loadConfig({ ...productionBase, AUTH_SECRET: shortSecret })).rejects.toThrow(/at least 32 characters/);
    await expect(loadConfig({ ...productionBase, AUTH_SECRET: 'change-me' })).rejects.toThrow(/known weak or default/);
    await expect(loadConfig({ ...productionBase, AUTH_SECRET: 'development-only-change-me' })).rejects.toThrow(/known weak or default/);
    try {
      const explicit = await loadConfig(productionBase);
      expect(explicit.config.authSecret).toBe(strongSecret);
    } catch (error: any) { throw new Error(`strong production secret rejected: ${error?.message}`); }

    let leaked = false;
    for (const candidate of ['tooshort0000001', 'change-me']) {
      try { await loadConfig({ ...productionBase, AUTH_SECRET: candidate }); } catch (error: any) { if (String(error?.message).includes(candidate)) leaked = true; }
    }
    expect(leaked).toBe(false);
  });

  it('accepts the CORS_ORIGINS alias and still rejects wildcard origins', async () => {
    const aliased = await loadConfig({ ...productionBase, CORS_ALLOWED_ORIGINS: undefined, CORS_ORIGINS: 'https://pilot.example.org' });
    expect(aliased.config.corsOrigins).toEqual(['https://pilot.example.org']);
    await expect(loadConfig({ ...productionBase, CORS_ORIGINS: '*', CORS_ALLOWED_ORIGINS: undefined })).rejects.toThrow(/explicit origins only/);
    await expect(loadConfig({ ...productionBase, CORS_ORIGINS: undefined, CORS_ALLOWED_ORIGINS: undefined })).rejects.toThrow(/CORS_ALLOWED_ORIGINS must be configured in production/);
  });

  it('returns a stable safe 413 envelope for oversized bodies without leaking internals', async () => {
    const app = buildApp();
    const response = await app.inject({ method: 'POST', url: '/api/v1/auth/login', payload: { username: 'x'.repeat(600_000), password: 'y'.repeat(600_000) } });
    expect(response.statusCode).toBe(413);
    const body = response.json();
    expect(body.error.code).toBe('VALIDATION_ERROR');
    expect(body.error.message).toBe('The request could not be completed');
    expect(typeof body.error.request_id).toBe('string');
    noLeak(response);
    await app.close();
  });

  it('preserves CORS and security-header behavior', async () => {
    const app = buildApp();
    const allowed = await app.inject({ method: 'OPTIONS', url: '/health', headers: { origin: 'http://localhost:5173', 'access-control-request-method': 'GET' } });
    expect(allowed.headers['access-control-allow-origin']).toBe('http://localhost:5173');
    const denied = await app.inject({ method: 'OPTIONS', url: '/health', headers: { origin: 'https://evil.example.org', 'access-control-request-method': 'GET' } });
    expect(denied.headers['access-control-allow-origin']).toBeUndefined();
    const hardened = await app.inject({ method: 'GET', url: '/health' });
    expect(String(hardened.headers['content-security-policy'])).toContain("frame-ancestors 'none'");
    expect(hardened.headers['x-content-type-options']).toBe('nosniff');
    await app.close();
  });

  it('exposes lightweight liveness that never touches the database', async () => {
    const app = buildApp();
    const response = await app.inject({ method: 'GET', url: '/health' });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: 'ok', service: 'nssms-api' });
    await app.close();
  });
});
