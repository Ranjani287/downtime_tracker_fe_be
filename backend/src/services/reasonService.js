import { DowntimeReason } from '../models/index.js';
import { reasonDto } from '../serializers.js';
import { findOwned, inTenant } from '../utils/tenant.js';

export async function listReasons(tenantId) {
  const reasons = await DowntimeReason.findAll({ where: inTenant(tenantId), order: [['category', 'ASC'], ['name', 'ASC']] });
  return reasons.map(reasonDto);
}

export async function createReason(tenantId, { name, category }) {
  return reasonDto(await DowntimeReason.create({ tenant_id: tenantId, name, category }));
}

export async function updateReason(tenantId, id, changes) {
  const reason = await findOwned(DowntimeReason, tenantId, id, 'Reason');
  await reason.update(changes);
  return reasonDto(reason);
}

export async function deleteReason(tenantId, id) {
  const reason = await findOwned(DowntimeReason, tenantId, id, 'Reason');
  await reason.destroy();
}
