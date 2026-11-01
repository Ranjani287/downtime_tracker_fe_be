import jwt from 'jsonwebtoken';
import { config } from '../config.js';
import { query } from '../db.js';
import { HttpError, wrap } from '../utils/errors.js';

// Authentication: verifies the Bearer JWT, rejects revoked (logged-out) tokens,
// and loads the user fresh from the DB so deactivated users lose access immediately.
// The tenant is taken ONLY from the DB row, never from client input.
export const authenticate = wrap(async (req, _res, next) => {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) throw new HttpError(401, 'Authentication required');

  let payload;
  try {
    payload = jwt.verify(token, config.jwtSecret, { algorithms: ['HS256'] });
  } catch {
    throw new HttpError(401, 'Invalid or expired token');
  }

  const revoked = await query('SELECT 1 FROM revoked_tokens WHERE jti = $1', [payload.jti]);
  if (revoked.rowCount) throw new HttpError(401, 'Token has been revoked');

  const { rows } = await query(
    `SELECT u.id, u.tenant_id, u.email, u.name, u.role, t.name AS tenant_name
       FROM users u LEFT JOIN tenants t ON t.id = u.tenant_id
      WHERE u.id = $1 AND u.active AND (t.id IS NULL OR t.active)`,
    [payload.sub]
  );
  if (!rows[0]) throw new HttpError(401, 'User or organisation no longer active');

  req.user = rows[0];
  req.token = { jti: payload.jti, exp: payload.exp };
  next();
});

// The super admin belongs to no organisation, so organisation data routes are closed to them.
export const requireTenant = (req, _res, next) =>
  req.user?.tenant_id ? next() : next(new HttpError(403, 'This endpoint requires an organisation account'));

// Authorization: role-based guard. Usage: authorize('admin', 'operator')
export const authorize = (...roles) => (req, _res, next) => {
  if (!req.user) return next(new HttpError(401, 'Authentication required'));
  if (!roles.includes(req.user.role)) return next(new HttpError(403, 'Insufficient permissions'));
  next();
};
