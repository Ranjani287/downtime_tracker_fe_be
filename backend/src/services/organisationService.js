import bcrypt from 'bcryptjs';
import { col, fn, literal } from 'sequelize';
import { sequelize } from '../db.js';
import { Tenant, User } from '../models/index.js';
import { tenantDto, userDto } from '../serializers.js';
import { notFound } from '../utils/errors.js';

// Platform-level operations on organisations (tenants). Only the super admin reaches these (see routes/platform.js).

const findOrg = async (id) => {
  const org = await Tenant.findByPk(id);
  if (!org) throw notFound('Organisation');
  return org;
};

const createAdmin = async (tenantId, { name, email, password }, transaction) =>
  User.create(
    { tenant_id: tenantId, name, email, role: 'admin', password_hash: await bcrypt.hash(password, 10) },
    { transaction },
  );

export async function listOrganisations() {
  const orgs = await Tenant.findAll({
    attributes: [
      'id', 'name', 'active', 'created_at',
      [fn('COUNT', col('users.id')), 'user_count'],
      [literal(`COUNT("users"."id") FILTER (WHERE "users"."role" = 'admin')`), 'admin_count'],
    ],
    include: [{ model: User, as: 'users', attributes: [], required: false }], // LEFT JOIN users + GROUP BY tenant
    group: ['Tenant.id'],
    order: [['name', 'ASC']],
    raw: true,
  });
  return orgs.map((o) => ({
    ...tenantDto(o), created_at: o.created_at, user_count: Number(o.user_count), admin_count: Number(o.admin_count),
  }));
}

// Creates the organisation and its first admin atomically: if the admin insert fails, the organisation is rolled back.
export async function createOrganisation({ name, admin }) {
  const { org, user } = await sequelize.transaction(async (transaction) => {
    const org = await Tenant.create({ name }, { transaction });
    return { org, user: await createAdmin(org.id, admin, transaction) };
  });
  return { ...tenantDto(org), admin: { id: user.id, email: user.email, name: user.name, role: user.role } };
}

export async function updateOrganisation(id, changes) {
  const org = await findOrg(id);
  await org.update(changes);
  return tenantDto(org);
}

export async function listOrganisationUsers(id) {
  const org = await findOrg(id);
  const users = await User.findAll({ where: { tenant_id: org.id }, order: [['role', 'ASC'], ['name', 'ASC']] });
  return users.map(userDto);
}

// Add another admin to an existing organisation (e.g. if the first one leaves).
export async function addOrganisationAdmin(id, admin) {
  const org = await findOrg(id);
  return userDto(await createAdmin(org.id, admin));
}
