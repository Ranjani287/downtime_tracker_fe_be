import 'dotenv/config';

export const config = {
  port: Number(process.env.PORT) || 4000,
  databaseUrl: process.env.DATABASE_URL,
  jwtSecret: process.env.JWT_SECRET,
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || '15m', // access token lifetime
  refreshTokenDays: Number(process.env.REFRESH_TOKEN_DAYS) || 7,
  corsOrigin: process.env.CORS_ORIGIN || 'http://localhost:5173',
  isProd: process.env.NODE_ENV === 'production',
  // How many reverse proxies sit in front of the API (hosting platform, CDN rewrite...). Express then reads the real
  // client IP from X-Forwarded-For, which the login rate limit needs. 0 locally; 1 by default in production.
  trustProxy: process.env.TRUST_PROXY !== undefined ? Number(process.env.TRUST_PROXY) : (process.env.NODE_ENV === 'production' ? 1 : 0),
  // Managed Postgres (Neon, Supabase, Render...) normally requires TLS.
  databaseSsl: process.env.DATABASE_SSL === 'true',
  // 'strict' when the SPA and API share a site (same domain / reverse proxy / dev proxy).
  // 'none' when they are hosted on different sites (requires HTTPS; cookie is then always Secure).
  cookieSameSite: (process.env.COOKIE_SAMESITE || 'strict').toLowerCase(),
};

if (!['strict', 'lax', 'none'].includes(config.cookieSameSite)) {
  throw new Error('COOKIE_SAMESITE must be one of: strict, lax, none');
}

for (const key of ['databaseUrl', 'jwtSecret']) {
  if (!config[key]) throw new Error(`Missing required env var for config.${key} (see .env.example)`);
}
