// @vitest-environment jsdom
// @vitest-environment-options {"url":"http://localhost/"}
import { describe, expect, it, vi } from 'vitest';
import { authTokenKey, logoutCurrentSession } from './auth-session';

describe('frontend logout', () => {
  it('calls the existing logout endpoint and clears application-owned authentication state', async () => {
    const values = new Map<string, string>();
    Object.defineProperty(window, 'localStorage', { configurable: true, value: { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => values.set(key, value), removeItem: (key: string) => values.delete(key) } });
    window.localStorage.setItem(authTokenKey, 'test-token');
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify({ success: true }), { status: 200 }));

    await logoutCurrentSession('test-token', fetcher as unknown as typeof fetch);

    expect(fetcher).toHaveBeenCalledWith(expect.stringContaining('/api/v1/auth/logout'), expect.objectContaining({ method: 'POST' }));
    expect(window.localStorage.getItem(authTokenKey)).toBeNull();
  });
});
