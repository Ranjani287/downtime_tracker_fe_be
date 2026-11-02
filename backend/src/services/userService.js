import bcrypt from 'bcryptjs';
import { User } from '../models/index.js';
import { userDto } from '../serializers.js';
import { HttpError } from '../utils/errors.js';
import { findOwned, inTenant } from '../utils/tenant.js';
import { revokeAllSessions } from './authService.js';

export async function listUsers(tenantId) {
  const users = await User.findAll({ where: inTenant(tenantId), order: [['role', 'ASC'], ['name', 'ASC']] });
  return users.map(userDto);
}

export async function createUser(tenantId, { name, email, password, role }) {
  const user = await User.create({ tenant_id: tenantId, name, email, role, password_hash: await bcrypt.hash(password, 10) });
  return userDto(user);
}

/** `actor` is the signed-in admin making the change. */
export async function updateUser(actor, id, { name, role, active, password }) {
  // Prevent an admin from locking themselves out of their organisation.
  if (id === actor.id && (active === false || (role && role !== 'admin'))) {
    throw new HttpError(400, 'You cannot deactivate or demote yourself');
  }
  const user = await findOwned(User, actor.tenant_id, id, 'User');
  await user.update({
    ...(name !== undefined && { name }),
    ...(role !== undefined && { role }),
    ...(active !== undefined && { active }),
    ...(password && { password_hash: await bcrypt.hash(password, 10) }),
  });
  // Deactivation or a password reset must end the user's existing sessions.
  if (active === false || password) await revokeAllSessions(user.id);
  return userDto(user);
}
