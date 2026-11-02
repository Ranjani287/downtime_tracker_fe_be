import { DowntimeEvent, Machine, ProductionLine } from '../models/index.js';
import { machineDto } from '../serializers.js';
import { HttpError } from '../utils/errors.js';
import { findOwned, inTenant } from '../utils/tenant.js';

// A machine with its line and (at most one) open downtime event; `is_down` is derived from the latter.
const withRelations = [
  { model: ProductionLine, as: 'line', attributes: ['name'] },
  { model: DowntimeEvent, as: 'openEvents', attributes: ['id'], required: false },
];

const loadMachine = (tenantId, id) => findOwned(Machine, tenantId, id, 'Machine', { include: withRelations });

async function assertLineOwned(tenantId, lineId) {
  if (!(await ProductionLine.count({ where: inTenant(tenantId, { id: lineId }) }))) {
    throw new HttpError(400, 'Unknown production line');
  }
}

export async function listMachines(tenantId, { line_id } = {}) {
  const machines = await Machine.findAll({
    where: inTenant(tenantId, line_id ? { line_id } : {}),
    include: withRelations,
    order: [[{ model: ProductionLine, as: 'line' }, 'name', 'ASC'], ['name', 'ASC']],
  });
  return machines.map(machineDto);
}

export async function createMachine(tenantId, { line_id, name }) {
  await assertLineOwned(tenantId, line_id);
  const created = await Machine.create({ tenant_id: tenantId, line_id, name });
  return machineDto(await loadMachine(tenantId, created.id));
}

export async function updateMachine(tenantId, id, changes) {
  const machine = await findOwned(Machine, tenantId, id, 'Machine');
  if (changes.line_id) await assertLineOwned(tenantId, changes.line_id);
  await machine.update(changes);
  return machineDto(await loadMachine(tenantId, id));
}

// Fails with 409 if the machine has downtime history (foreign key); deactivate instead.
export async function deleteMachine(tenantId, id) {
  const machine = await findOwned(Machine, tenantId, id, 'Machine');
  await machine.destroy();
}
