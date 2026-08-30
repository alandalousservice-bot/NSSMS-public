import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { buildApp } from '../src/app.js';
import { config } from '../src/config.js';
import { pool } from '../src/infrastructure/db.js';

const enabled = Boolean(process.env.DATABASE_URL && process.env.AUTH_SECRET);
const suite = enabled ? describe : describe.skip;
const app = enabled ? buildApp() : null;
app?.get('/__operational-error', async () => { throw new Error('postgresql password=secret SELECT * FROM private_table'); });
app?.get('/__operational-rate', { config: { rateLimit: { max: 1, timeWindow: '1 minute' } } }, async () => ({ ok: true }));

suite('ARCH-015 A1 operational foundation', () => {
  beforeAll(async () => { await app!.ready(); });
  afterAll(async () => { await app?.close(); });

  it('generates and returns opaque request IDs and uses a safe standard error envelope', async () => {
    const health = await app!.inject({ method: 'GET', url: '/health' });
    expect(health.statusCode).toBe(200);
    expect(health.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/i);
    expect(health.json()).toEqual({ status: 'ok', service: 'nssms-api' });
    const failed = await app!.inject({ method: 'GET', url: '/__operational-error' });
    expect(failed.statusCode).toBe(500);
    expect(failed.json().error).toEqual({ code: 'INTERNAL_ERROR', message: 'An internal error occurred', request_id: failed.headers['x-request-id'] });
    expect(failed.body).not.toMatch(/postgres|password|private_table|stack|select/i);
    const missing = await app!.inject({ method: 'GET', url: '/missing-route' });
    expect(missing.statusCode).toBe(404);
    expect(missing.json().error).toMatchObject({ code: 'NOT_FOUND', request_id: missing.headers['x-request-id'] });
  });

  it('applies explicit CORS, security headers, and the configured JSON body limit', async () => {
    const allowed = await app!.inject({ method: 'OPTIONS', url: '/health', headers: { origin: config.corsOrigins[0], 'access-control-request-method': 'GET' } });
    expect(allowed.headers['access-control-allow-origin']).toBe(config.corsOrigins[0]);
    const denied = await app!.inject({ method: 'OPTIONS', url: '/health', headers: { origin: 'https://unapproved.example', 'access-control-request-method': 'GET' } });
    expect(denied.headers['access-control-allow-origin']).toBeUndefined();
    const secured = await app!.inject({ method: 'GET', url: '/health' });
    expect(secured.headers['x-content-type-options']).toBe('nosniff');
    expect(secured.headers['referrer-policy']).toBe('no-referrer');
    expect(secured.headers['content-security-policy']).toContain("default-src 'none'");
    const tooLarge = await app!.inject({ method: 'POST', url: '/api/v1/auth/login', headers: { 'content-type': 'application/json' }, payload: JSON.stringify({ username: 'a', password: 'x'.repeat(config.bodyLimit) }) });
    expect(tooLarge.statusCode).toBe(413);
    expect(tooLarge.json().error).toMatchObject({ code: 'VALIDATION_ERROR', request_id: tooLarge.headers['x-request-id'] });
  });

  it('returns a stable rate-limit response and safe readiness responses', async () => {
    const ready = await app!.inject({ method: 'GET', url: '/ready' });
    expect(ready.statusCode).toBe(200); expect(ready.json()).toEqual({ status: 'ready', database: 'ok' });
    const query = vi.spyOn(pool, 'query').mockRejectedValueOnce(new Error('postgres://user:password@host/database'));
    const unavailable = await app!.inject({ method: 'GET', url: '/ready' });
    expect(unavailable.statusCode).toBe(503); expect(unavailable.json()).toEqual({ status: 'not_ready', database: 'unavailable' });
    expect(unavailable.body).not.toMatch(/postgres|password|host|stack/i);
    query.mockRestore();
    await app!.inject({ method: 'GET', url: '/__operational-rate' });
    const limited = await app!.inject({ method: 'GET', url: '/__operational-rate' });
    expect(limited.statusCode).toBe(429);
    expect(limited.json().error).toMatchObject({ code: 'RATE_LIMITED', request_id: limited.headers['x-request-id'] });
  });

  it('fails fast for insecure production configuration', async () => {
    const previous = { NODE_ENV: process.env.NODE_ENV, AUTH_SECRET: process.env.AUTH_SECRET, DATABASE_URL: process.env.DATABASE_URL };
    process.env.NODE_ENV = 'production'; process.env.AUTH_SECRET = 'short'; process.env.DATABASE_URL = '';
    await vi.resetModules();
    await expect(import('../src/config.js')).rejects.toThrow('AUTH_SECRET must be at least 32 characters long');
    process.env.AUTH_SECRET = 'operational-foundation-strong-secret-0123456789abcdef';
    await vi.resetModules();
    await expect(import('../src/config.js')).rejects.toThrow('DATABASE_URL is required in production');
    process.env.NODE_ENV = previous.NODE_ENV; process.env.AUTH_SECRET = previous.AUTH_SECRET; process.env.DATABASE_URL = previous.DATABASE_URL;
    await vi.resetModules();
  });
});
