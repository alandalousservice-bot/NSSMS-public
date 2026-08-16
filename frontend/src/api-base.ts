const configuredApiUrl = import.meta.env.VITE_API_URL?.trim();

// Keep local browser sessions on the same host name as the Vite origin. A
// deployment with a separate API origin continues to set VITE_API_URL.
const browserApiUrl = typeof window === 'undefined' ? 'http://localhost:3000' : `${window.location.protocol}//${window.location.hostname}:3000`;
export const API_BASE_URL = configuredApiUrl || browserApiUrl;
