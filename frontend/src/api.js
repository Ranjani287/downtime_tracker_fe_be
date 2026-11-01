// The access token lives only in memory (never localStorage), so XSS can't steal a persistent credential.
// The long-lived refresh token is an httpOnly cookie that JavaScript cannot read; the browser sends it
// to /api/auth/* automatically, and we use it to get a fresh access token.
let accessToken = null;

// Base URL of the backend API. Empty/unset -> relative "/api" (dev proxy or a same-origin reverse proxy).
// Set VITE_API_URL (e.g. https://api.example.com/api) when the API is hosted separately.
const BASE = (import.meta.env.VITE_API_URL || '/api').replace(/\/+$/, '');

export const setAccessToken = (t) => { accessToken = t; };

export class ApiError extends Error {
  constructor(status, message, details) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

// Marks the request as same-site XHR; the API requires it on cookie-authenticated endpoints (CSRF defence).
const BASE_HEADERS = { 'X-Requested-With': 'XMLHttpRequest' };

async function send(path, { method = 'GET', body, params, token } = {}) {
  const qs = params
    ? '?' + new URLSearchParams(Object.entries(params).filter(([, v]) => v !== '' && v != null)).toString()
    : '';
  const res = await fetch(`${BASE}${path}${qs}`, {
    method,
    credentials: 'include', // send/receive the httpOnly refresh cookie (also cross-origin when the API is hosted separately)
    headers: {
      ...BASE_HEADERS,
      ...(body && { 'Content-Type': 'application/json' }),
      ...(token && { Authorization: `Bearer ${token}` }),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (res.status === 204) return null;
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, data.error || 'Request failed', data.details);
  return data;
}

// Single-flight: concurrent callers (several 401s at once, React StrictMode double effects)
// share one refresh request. Rotating refresh tokens would otherwise race against each other.
let refreshing = null;

export function refreshSession() {
  if (!refreshing) {
    refreshing = (async () => {
      try {
        return await send('/auth/refresh', { method: 'POST' });
      } catch (e) {
        // 409 = another tab rotated the token a moment ago; the cookie is already updated, so retry once.
        if (e.status === 409) return send('/auth/refresh', { method: 'POST' });
        throw e;
      }
    })()
      .then((data) => { accessToken = data.token; return data; })
      .finally(() => { refreshing = null; });
  }
  return refreshing;
}

export async function api(path, options = {}) {
  try {
    return await send(path, { ...options, token: accessToken });
  } catch (e) {
    // Access token expired or revoked: refresh once and replay the request.
    if (e.status === 401 && !path.startsWith('/auth/')) {
      try {
        await refreshSession();
      } catch {
        accessToken = null;
        window.dispatchEvent(new Event('auth:expired')); // refresh failed -> back to login
        throw e;
      }
      return send(path, { ...options, token: accessToken });
    }
    throw e;
  }
}

// Used by the auth context; these bypass the refresh-and-retry logic above.
export const authApi = {
  async login(email, password) {
    const data = await send('/auth/login', { method: 'POST', body: { email, password } });
    accessToken = data.token;
    return data;
  },
  async logout() {
    try {
      await send('/auth/logout', { method: 'POST', token: accessToken });
    } finally {
      accessToken = null;
    }
  },
};
