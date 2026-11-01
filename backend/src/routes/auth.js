import { Router } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { z } from 'zod';
import rateLimit from 'express-rate-limit';
import { config } from '../config.js';
import { pool, query } from '../db.js';
import { authenticate } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { HttpError, wrap } from '../utils/errors.js';

const router = Router();

const COOKIE = 'refresh_token';
// Two requests rotating the same token within this window (e.g. two tabs) are a race, not theft.
const ROTATION_GRACE_MS = 10_000;

// httpOnly: JS can't read it (XSS-safe). SameSite=Strict + path-scoped: only sent to /api/auth from our own site.
const cookieOptions = {
  httpOnly: true,
  secure: config.isProd || config.cookieSameSite === 'none', // browsers require Secure with SameSite=None
  sameSite: config.cookieSameSite,
  path: '/api/auth',
};

const limiter = (limit, message) => rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: process.env.NODE_ENV === 'test' ? 1000 : limit,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: message },
});
const loginLimiter = limiter(20, 'Too many login attempts, try again later');
const refreshLimiter = limiter(120, 'Too many refresh attempts, try again later');

// CSRF defence for the cookie-authenticated endpoints: browsers cannot add a custom header
// on a cross-site request without a CORS preflight, which our CORS policy rejects.
const requireXhr = (req, _res, next) =>
  req.get('x-requested-with') === 'XMLHttpRequest'
    ? next()
    : next(new HttpError(403, 'Missing X-Requested-With header'));

const sha256 = (v) => createHash('sha256').update(v).digest('hex');

const signAccessToken = (user) =>
  jwt.sign({ sub: String(user.id), role: user.role }, config.jwtSecret, {
    algorithm: 'HS256',
    expiresIn: config.jwtExpiresIn,
    jwtid: randomUUID(),
  });

// Stores a new refresh token (hashed) and sets it as an httpOnly cookie.
async function issueRefreshToken(db, userId, familyId) {
  const raw = randomBytes(48).toString('base64url');
  const expiresAt = new Date(Date.now() + config.refreshTokenDays * 864e5);
  const { rows } = await db.query(
    `INSERT INTO refresh_tokens (user_id, family_id, token_hash, expires_at)
     VALUES ($1,$2,$3,$4) RETURNING id`,
    [userId, familyId, sha256(raw), expiresAt]
  );
  return { id: rows[0].id, raw, expiresAt };
}

const setRefreshCookie = (res, { raw, expiresAt }) => res.cookie(COOKIE, raw, { ...cookieOptions, expires: expiresAt });
const clearRefreshCookie = (res) => res.clearCookie(COOKIE, cookieOptions);

const revokeFamily = (familyId) =>
  query('UPDATE refresh_tokens SET revoked_at = now() WHERE family_id = $1 AND revoked_at IS NULL', [familyId]);

const loadActiveUser = async (id) =>
  (await query(
    `SELECT u.id, u.tenant_id, u.email, u.name, u.role, t.name AS tenant_name
       FROM users u LEFT JOIN tenants t ON t.id = u.tenant_id
      WHERE u.id = $1 AND u.active AND (t.id IS NULL OR t.active)`,
    [id]
  )).rows[0];

const loginSchema = z.object({ email: z.string().email(), password: z.string().min(1) });

// Pre-computed hash so unknown emails cost the same as wrong passwords (mitigates user enumeration by timing).
const DUMMY_HASH = bcrypt.hashSync('not-a-real-password', 10);

router.post('/login', loginLimiter, validate(loginSchema), wrap(async (req, res) => {
  const { email, password } = req.body;
  const { rows } = await query(
    `SELECT u.id, u.tenant_id, u.email, u.name, u.role, u.password_hash, t.name AS tenant_name
       FROM users u LEFT JOIN tenants t ON t.id = u.tenant_id
      WHERE lower(u.email) = lower($1) AND u.active AND (t.id IS NULL OR t.active)`,
    [email]
  );
  const user = rows[0];
  const ok = await bcrypt.compare(password, user ? user.password_hash : DUMMY_HASH);
  if (!user || !ok) throw new HttpError(401, 'Invalid email or password');

  const refresh = await issueRefreshToken({ query }, user.id, randomUUID()); // new family per login
  setRefreshCookie(res, refresh);
  query("DELETE FROM refresh_tokens WHERE expires_at < now() - interval '1 day'").catch(() => {}); // housekeeping

  const { password_hash, ...safe } = user;
  res.json({ token: signAccessToken(user), user: safe });
}));

// Exchanges the refresh cookie for a new access token, rotating the refresh token.
router.post('/refresh', refreshLimiter, requireXhr, wrap(async (req, res) => {
  const raw = req.cookies?.[COOKIE];
  if (!raw) throw new HttpError(401, 'No session');

  const row = (await query('SELECT * FROM refresh_tokens WHERE token_hash = $1', [sha256(raw)])).rows[0];
  if (!row) {
    clearRefreshCookie(res);
    throw new HttpError(401, 'Invalid session');
  }

  if (row.revoked_at) {
    // Benign race: this token was rotated moments ago by another request/tab that already got the new cookie.
    if (row.replaced_by && Date.now() - new Date(row.revoked_at).getTime() < ROTATION_GRACE_MS) {
      throw new HttpError(409, 'Refresh already in progress, retry');
    }
    // Otherwise an already-used or logged-out token came back: assume theft and kill the whole session family.
    await revokeFamily(row.family_id);
    clearRefreshCookie(res);
    throw new HttpError(401, 'Session revoked');
  }

  if (new Date(row.expires_at) <= new Date()) {
    clearRefreshCookie(res);
    throw new HttpError(401, 'Session expired');
  }

  const user = await loadActiveUser(row.user_id);
  if (!user) {
    await revokeFamily(row.family_id);
    clearRefreshCookie(res);
    throw new HttpError(401, 'User or organisation no longer active');
  }

  // Rotate atomically: the conditional UPDATE guarantees only one concurrent request wins.
  const client = await pool.connect();
  let next;
  try {
    await client.query('BEGIN');
    const claimed = await client.query(
      'UPDATE refresh_tokens SET revoked_at = now() WHERE id = $1 AND revoked_at IS NULL RETURNING id',
      [row.id]
    );
    if (!claimed.rowCount) {
      await client.query('ROLLBACK');
      throw new HttpError(409, 'Refresh already in progress, retry');
    }
    next = await issueRefreshToken(client, user.id, row.family_id);
    await client.query('UPDATE refresh_tokens SET replaced_by = $2 WHERE id = $1', [row.id, next.id]);
    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    client.release();
  }

  setRefreshCookie(res, next);
  res.json({ token: signAccessToken(user), user });
}));

router.get('/me', authenticate, (req, res) => res.json({ user: req.user }));

// Logout ends the whole session: revokes the refresh-token family and the current access token.
// Deliberately does not require a valid access token, so a user with an expired one can still log out.
router.post('/logout', requireXhr, wrap(async (req, res) => {
  const raw = req.cookies?.[COOKIE];
  if (raw) {
    const row = (await query('SELECT family_id FROM refresh_tokens WHERE token_hash = $1', [sha256(raw)])).rows[0];
    if (row) await revokeFamily(row.family_id);
  }

  const bearer = (req.headers.authorization || '').replace(/^Bearer /, '');
  if (bearer) {
    try {
      const payload = jwt.verify(bearer, config.jwtSecret, { algorithms: ['HS256'] });
      await query(
        'INSERT INTO revoked_tokens (jti, expires_at) VALUES ($1, to_timestamp($2)) ON CONFLICT DO NOTHING',
        [payload.jti, payload.exp]
      );
    } catch { /* expired or invalid: nothing left to revoke */ }
  }
  await query('DELETE FROM revoked_tokens WHERE expires_at < now()'); // housekeeping

  clearRefreshCookie(res);
  res.json({ message: 'Logged out' });
}));

export default router;
