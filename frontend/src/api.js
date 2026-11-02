import axios from 'axios';

// The access token lives only in memory (never localStorage), so XSS can't steal a persistent credential.
// The long-lived refresh token is an httpOnly cookie that JavaScript cannot read; the browser sends it
// to /api/auth/* automatically, and we use it to get a fresh access token.
let accessToken = null;
export const setAccessToken = (t) => { accessToken = t; };

// Base URL of the backend API. Empty/unset -> relative "/api" (dev proxy or a same-origin reverse proxy).
// Set VITE_API_URL (e.g. https://api.example.com/api) when the API is hosted separately.
const BASE = (import.meta.env.VITE_API_URL || '/api').replace(/\/+$/, '');

/** The one error type the UI handles: HTTP status, the server's message, and per-field validation details. */
export class ApiError extends Error {
  constructor(status, message, details) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

const http = axios.create({
  baseURL: BASE,
  withCredentials: true, // send/receive the httpOnly refresh cookie (also cross-origin when the API is hosted separately)
  timeout: 15_000,
  headers: { 'X-Requested-With': 'XMLHttpRequest' }, // the API requires this on cookie endpoints (CSRF defence)
});

// ---- request: attach the in-memory access token, and don't send empty filters ("" / null) as query params
http.interceptors.request.use((config) => {
  if (accessToken) config.headers.Authorization = `Bearer ${accessToken}`;
  if (config.params) {
    config.params = Object.fromEntries(Object.entries(config.params).filter(([, v]) => v !== '' && v != null));
  }
  return config;
});

// Single-flight: concurrent callers (several 401s at once, React StrictMode double effects) share one refresh
// request. Refresh tokens rotate, so parallel refreshes would otherwise race against each other.
let refreshing = null;

export function refreshSession() {
  if (!refreshing) {
    refreshing = (async () => {
      try {
        return (await http.post('/auth/refresh')).data;
      } catch (e) {
        // 409 = another tab rotated the token a moment ago; the cookie is already updated, so retry once.
        if (e.status === 409) return (await http.post('/auth/refresh')).data;
        throw e;
      }
    })()
      .then((data) => { accessToken = data.token; return data; })
      .finally(() => { refreshing = null; });
  }
  return refreshing;
}

// ---- response (1st interceptor): access token expired or revoked -> refresh once, then replay the request
http.interceptors.response.use(undefined, async (error) => {
  const request = error.config;
  const unauthorized = error.response?.status === 401;
  if (unauthorized && request && !request._retried && !request.url.startsWith('/auth/')) {
    request._retried = true;
    try {
      await refreshSession();
    } catch {
      accessToken = null;
      window.dispatchEvent(new Event('auth:expired')); // refresh failed -> back to login
      throw error;
    }
    return http(request); // same request, now carrying the new access token
  }
  throw error;
});

// ---- response (2nd interceptor): turn any failure into an ApiError so pages never see axios internals
http.interceptors.response.use(undefined, (error) => {
  if (error instanceof ApiError) throw error; // already normalized (a retried request that failed again)
  if (!error.response) {
    const message = error.code === 'ECONNABORTED' ? 'The server took too long to respond' : 'Cannot reach the server';
    throw new ApiError(0, message);
  }
  const { status, data } = error.response;
  throw new ApiError(status, data?.error || 'Request failed', data?.details);
});

/** api('/lines'), api('/downtime', { params }), api('/lines', { method: 'POST', body }) -> parsed JSON (null for 204). */
export async function api(path, { method = 'GET', body, params } = {}) {
  const res = await http.request({ url: path, method, data: body, params });
  return res.status === 204 ? null : res.data;
}

// Used by the auth context.
export const authApi = {
  async login(email, password) {
    const { data } = await http.post('/auth/login', { email, password });
    accessToken = data.token;
    return data;
  },
  async logout() {
    try {
      await http.post('/auth/logout');
    } finally {
      accessToken = null;
    }
  },
};
