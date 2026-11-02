import { authenticateAccessToken } from '../services/authService.js';
import { HttpError, wrap } from '../utils/errors.js';

// Authentication: reads the Bearer token and asks the auth service to validate it
// (signature, expiry, not logged out, user and organisation still active).
export const authenticate = wrap(async (req, _res, next) => {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) throw new HttpError(401, 'Authentication required');

  const { user, token: claims } = await authenticateAccessToken(token);
  req.user = user;
  req.token = claims;
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
