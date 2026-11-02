import { notFound } from './errors.js';

/**
 * Tenant isolation at the data-access layer: every query on a tenant-owned model builds its `where`
 * through this helper, so the tenant filter can't be forgotten and always comes from the authenticated user.
 *   Machine.findAll({ where: inTenant(req.user.tenant_id, { active: true }) })
 */
export const inTenant = (tenantId, where = {}) => ({ ...where, tenant_id: tenantId });

/**
 * Loads one row by id inside the tenant, or throws 404. A row that belongs to another tenant is
 * indistinguishable from one that doesn't exist, so guessed ids leak nothing.
 */
export async function findOwned(Model, tenantId, id, label, options = {}) {
  const row = await Model.findOne({ ...options, where: inTenant(tenantId, { id }) });
  if (!row) throw notFound(label);
  return row;
}
