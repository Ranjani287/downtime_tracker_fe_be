import { col, fn } from 'sequelize';
import { Machine, ProductionLine } from '../models/index.js';
import { lineDto } from '../serializers.js';
import { findOwned, inTenant } from '../utils/tenant.js';

export async function listLines(tenantId) {
  const lines = await ProductionLine.findAll({
    where: inTenant(tenantId),
    attributes: ['id', 'name', 'active', [fn('COUNT', col('machines.id')), 'machine_count']],
    include: [{ model: Machine, as: 'machines', attributes: [], required: false }], // LEFT JOIN + GROUP BY
    group: ['ProductionLine.id'],
    order: [['name', 'ASC']],
    raw: true,
  });
  return lines.map((l) => ({ ...lineDto(l), machine_count: Number(l.machine_count) }));
}

export async function createLine(tenantId, { name }) {
  return lineDto(await ProductionLine.create({ tenant_id: tenantId, name }));
}

export async function updateLine(tenantId, id, changes) {
  const line = await findOwned(ProductionLine, tenantId, id, 'Line');
  await line.update(changes);
  return lineDto(line);
}

// Fails with 409 if machines still belong to the line (foreign key); deactivate instead.
export async function deleteLine(tenantId, id) {
  const line = await findOwned(ProductionLine, tenantId, id, 'Line');
  await line.destroy();
}
