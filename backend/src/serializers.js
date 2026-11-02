import { Machine, ProductionLine, DowntimeReason, User } from './models/index.js';

// Shapes model instances into the JSON the API returns (the "view" side of the mapping).
// Routes never send model instances straight out, so internal columns (tenant_id, password_hash...) can't leak.

export const tenantDto = (t) => ({ id: t.id, name: t.name, active: t.active });

export const lineDto = (l) => ({ id: l.id, name: l.name, active: l.active });

export const machineDto = (m) => ({
  id: m.id,
  name: m.name,
  active: m.active,
  line_id: m.line_id,
  line_name: m.line.name,
  is_down: m.openEvents.length > 0,
});

export const reasonDto = (r) => ({ id: r.id, name: r.name, category: r.category, active: r.active });

export const userDto = (u) => ({ id: u.id, name: u.name, email: u.email, role: u.role, active: u.active });

export const eventDto = (e) => ({
  id: e.id,
  machine_id: e.machine_id,
  machine_name: e.machine.name,
  line_id: e.machine.line_id,
  line_name: e.machine.line.name,
  reason_id: e.reason_id,
  reason_name: e.reason.name,
  reason_category: e.reason.category,
  started_at: e.started_at,
  ended_at: e.ended_at,
  note: e.note,
  created_by: e.created_by,
  created_by_name: e.creator.name,
  duration_minutes: e.duration_minutes,
});

// What the client needs to know about the signed-in user (login / refresh / me).
export const sessionUserDto = (u) => ({
  id: u.id,
  tenant_id: u.tenant_id,
  email: u.email,
  name: u.name,
  role: u.role,
  tenant_name: u.tenant?.name ?? null,
});

// Reusable `include` trees, so every route that returns events or machines loads the same relations.
export const eventInclude = ({ lineId } = {}) => [
  {
    model: Machine, as: 'machine', required: true,
    ...(lineId && { where: { line_id: lineId } }),
    include: [{ model: ProductionLine, as: 'line' }],
  },
  { model: DowntimeReason, as: 'reason' },
  { model: User, as: 'creator', attributes: ['id', 'name'] },
];
