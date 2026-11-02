import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { config } from '../config.js';
import { authenticate } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import * as authService from '../services/authService.js';
import { HttpError, wrap } from '../utils/errors.js';

// HTTP concerns only: rate limits, the refresh cookie, CSRF header. The logic lives in services/authService.js.
const router = Router();

const COOKIE = 'refresh_token';

// httpOnly: JS can't read it (XSS-safe). SameSite + path-scoped: only sent to /api/auth from our own site.
const cookieOptions = {
  httpOnly: true,
  secure: config.isProd || config.cookieSameSite === 'none', // browsers require Secure with SameSite=None
  sameSite: config.cookieSameSite,
  path: '/api/auth',
};
const setRefreshCookie = (res, { raw, expiresAt }) => res.cookie(COOKIE, raw, { ...cookieOptions, expires: expiresAt });
const clearRefreshCookie = (res) => res.clearCookie(COOKIE, cookieOptions);

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

const loginSchema = z.object({ email: z.string().email(), password: z.string().min(1) });

router.post('/login', loginLimiter, validate(loginSchema), wrap(async (req, res) => {
  const { token, user, refreshToken } = await authService.login(req.body.email, req.body.password);
  setRefreshCookie(res, refreshToken);
  res.json({ token, user });
}));

// New access token + rotated refresh cookie.
router.post('/refresh', refreshLimiter, requireXhr, wrap(async (req, res) => {
  try {
    const { token, user, refreshToken } = await authService.refresh(req.cookies?.[COOKIE]);
    setRefreshCookie(res, refreshToken);
    res.json({ token, user });
  } catch (err) {
    if (err.clearSession) clearRefreshCookie(res); // the service says this session is dead
    throw err;
  }
}));

router.get('/me', authenticate, (req, res) => res.json({ user: req.user }));

// Works even with an expired access token, so a user can always log out.
router.post('/logout', requireXhr, wrap(async (req, res) => {
  await authService.logout({
    rawRefreshToken: req.cookies?.[COOKIE],
    accessToken: (req.headers.authorization || '').replace(/^Bearer /, ''),
  });
  clearRefreshCookie(res);
  res.json({ message: 'Logged out' });
}));

export default router;
