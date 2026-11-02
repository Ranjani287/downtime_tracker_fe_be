import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { Op } from 'sequelize';
import { config } from '../config.js';
import { sequelize } from '../db.js';
import { RefreshToken, RevokedToken, Tenant, User } from '../models/index.js';
import { sessionUserDto } from '../serializers.js';
import { HttpError } from '../utils/errors.js';

// Two requests rotating the same token within this window (e.g. two tabs) are a race, not theft.
const ROTATION_GRACE_MS = 10_000;

// Pre-computed hash so unknown emails cost the same as wrong passwords (mitigates user enumeration by timing).
const DUMMY_HASH = bcrypt.hashSync('not-a-real-password', 10);

const sha256 = (v) => createHash('sha256').update(v).digest('hex');

// An error after which the HTTP layer should also clear the refresh cookie.
const endSession = (status, message) => Object.assign(new HttpError(status, message), { clearSession: true });

const signAccessToken = (user) =>
  jwt.sign({ sub: String(user.id), role: user.role }, config.jwtSecret, {
    algorithm: 'HS256',
    expiresIn: config.jwtExpiresIn,
    jwtid: randomUUID(),
  });

// Stores a new refresh token (only its hash). `transaction` is optional.
async function issueRefreshToken(userId, familyId, transaction) {
  const raw = randomBytes(48).toString('base64url');
  const expiresAt = new Date(Date.now() + config.refreshTokenDays * 864e5);
  const row = await RefreshToken.create(
    { user_id: userId, family_id: familyId, token_hash: sha256(raw), expires_at: expiresAt },
    { transaction },
  );
  return { id: row.id, raw, expiresAt };
}

const revokeFamily = (familyId) =>
  RefreshToken.update({ revoked_at: sequelize.fn('now') }, { where: { family_id: familyId, revoked_at: null } });

const withTenant = [{ model: Tenant, as: 'tenant', attributes: ['name', 'active'], required: false }]; // super admin has none

/**
 * Validates an access token for the auth middleware: signature + expiry, not revoked (logged out), and the user
 * (and their organisation) still active. Loading the user fresh means deactivation takes effect immediately.
 * The tenant comes only from the database row, never from client input.
 */
export async function authenticateAccessToken(token) {
  let payload;
  try {
    payload = jwt.verify(token, config.jwtSecret, { algorithms: ['HS256'] });
  } catch {
    throw new HttpError(401, 'Invalid or expired token');
  }
  if (await RevokedToken.findByPk(payload.jti)) throw new HttpError(401, 'Token has been revoked');

  const user = await User.findOne({ where: { id: payload.sub, active: true }, include: withTenant });
  if (!user || (user.tenant && !user.tenant.active)) throw new HttpError(401, 'User or organisation no longer active');
  return { user: sessionUserDto(user), token: { jti: payload.jti, exp: payload.exp } };
}

/** Checks credentials. Returns the access token, the user and a new refresh token (new family per login). */
export async function login(email, password) {
  // unscoped(): the only place that needs the password hash
  const found = await User.unscoped().findOne({
    where: sequelize.where(sequelize.fn('lower', sequelize.col('User.email')), email.toLowerCase()),
    include: withTenant,
  });
  const user = found && found.active && (!found.tenant || found.tenant.active) ? found : null;

  const ok = await bcrypt.compare(password, user ? user.password_hash : DUMMY_HASH);
  if (!user || !ok) throw new HttpError(401, 'Invalid email or password');

  const refreshToken = await issueRefreshToken(user.id, randomUUID());
  RefreshToken.destroy({ where: { expires_at: { [Op.lt]: new Date(Date.now() - 864e5) } } }).catch(() => {}); // housekeeping
  return { token: signAccessToken(user), user: sessionUserDto(user), refreshToken };
}

/**
 * Exchanges a refresh token for a new access token, rotating the refresh token.
 * Presenting an already-used token revokes the whole family (assumed theft).
 */
export async function refresh(rawToken) {
  if (!rawToken) throw new HttpError(401, 'No session');

  const row = await RefreshToken.findOne({ where: { token_hash: sha256(rawToken) } });
  if (!row) throw endSession(401, 'Invalid session');

  if (row.revoked_at) {
    // Benign race: rotated moments ago by another request/tab that already received the new cookie.
    if (row.replaced_by && Date.now() - row.revoked_at.getTime() < ROTATION_GRACE_MS) {
      throw new HttpError(409, 'Refresh already in progress, retry');
    }
    await revokeFamily(row.family_id);
    throw endSession(401, 'Session revoked');
  }
  if (row.expires_at <= new Date()) throw endSession(401, 'Session expired');

  const user = await User.findOne({ where: { id: row.user_id, active: true }, include: withTenant });
  if (!user || (user.tenant && !user.tenant.active)) {
    await revokeFamily(row.family_id);
    throw endSession(401, 'User or organisation no longer active');
  }

  // Rotate atomically: the conditional UPDATE guarantees only one concurrent request can claim the token.
  // (If the callback throws, Sequelize rolls the transaction back.)
  const refreshToken = await sequelize.transaction(async (transaction) => {
    const [claimed] = await RefreshToken.update(
      { revoked_at: sequelize.fn('now') },
      { where: { id: row.id, revoked_at: null }, transaction },
    );
    if (!claimed) throw new HttpError(409, 'Refresh already in progress, retry');
    const issued = await issueRefreshToken(user.id, row.family_id, transaction);
    await RefreshToken.update({ replaced_by: issued.id }, { where: { id: row.id }, transaction });
    return issued;
  });

  return { token: signAccessToken(user), user: sessionUserDto(user), refreshToken };
}

/** Ends the whole session: revokes the refresh-token family and denylists the access token. Never throws for bad tokens. */
export async function logout({ rawRefreshToken, accessToken }) {
  if (rawRefreshToken) {
    const row = await RefreshToken.findOne({ where: { token_hash: sha256(rawRefreshToken) }, attributes: ['family_id'] });
    if (row) await revokeFamily(row.family_id);
  }
  if (accessToken) {
    try {
      const payload = jwt.verify(accessToken, config.jwtSecret, { algorithms: ['HS256'] });
      await RevokedToken.upsert({ jti: payload.jti, expires_at: new Date(payload.exp * 1000) });
    } catch { /* expired or invalid: nothing left to revoke */ }
  }
  await RevokedToken.destroy({ where: { expires_at: { [Op.lt]: new Date() } } }); // housekeeping
}

/** Ends every session of a user (used when they are deactivated or their password changes). */
export const revokeAllSessions = (userId) =>
  RefreshToken.update({ revoked_at: sequelize.fn('now') }, { where: { user_id: userId, revoked_at: null } });
