import { API_BASE_URL } from './api-base';

export const authTokenKey = 'nssms_token';

export async function logoutCurrentSession(token: string, fetcher: typeof fetch = fetch) {
  try {
    await fetcher(`${API_BASE_URL}/api/v1/auth/logout`, { method: 'POST', headers: { authorization: `Bearer ${token}` } });
  } finally {
    window.localStorage.removeItem(authTokenKey);
  }
}
