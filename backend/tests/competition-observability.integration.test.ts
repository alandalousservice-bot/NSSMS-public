import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Writable } from 'node:stream';
import pino from 'pino';
import { buildApp } from '../src/app.js';

const lines: string[] = [];
const sink = new Writable({ write(chunk, _encoding, callback) { lines.push(chunk.toString()); callback(); } });
const app = buildApp({ loggerInstance: pino({ level: 'info' }, sink) });
app.get('/__a3-observability-error', async () => { throw new Error('password=not-for-log Authorization: Bearer test-token'); });

describe('ARCH-015 A3 observability contracts', () => {
  beforeAll(async () => { await app.ready(); });
  afterAll(async () => { await app.close(); });

  it('writes structured request context without headers, tokens, passwords, or raw error text', async () => {
    const response = await app.inject({ method: 'GET', url: '/__a3-observability-error', headers: { authorization: 'Bearer test-token' } });
    expect(response.statusCode).toBe(500);
    expect(response.headers['cache-control']).toBe('private, no-store');
    expect(response.headers['x-request-id']).toBe(response.json().error.request_id);
    expect(response.body).not.toMatch(/password|authorization|token|stack/i);
    const combined = lines.join('');
    expect(combined).toContain('"request_id"');
    expect(combined).toContain('"method":"GET"');
    expect(combined).toContain('"route":"/__a3-observability-error"');
    expect(combined).toContain('"status":500');
    expect(combined).toContain('"duration_ms"');
    expect(combined).toContain('"error_code":"INTERNAL_ERROR"');
    expect(combined).not.toMatch(/password|authorization|test-token|bearer/i);
  });
});
