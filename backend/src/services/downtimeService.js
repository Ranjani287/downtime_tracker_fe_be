import { Op } from 'sequelize';
import { DowntimeEvent, DowntimeReason, Machine, ProductionLine } from '../models/index.js';
import { eventDto, eventInclude } from '../serializers.js';
import { HttpError, notFound } from '../utils/errors.js';
import { findOwned, inTenant } from '../utils/tenant.js';

const findEvent = (tenantId, id) =>
  DowntimeEvent.findOne({ where: inTenant(tenantId, { id }), include: eventInclude() });

export async function getEvent(tenantId, id) {
  const event = await findEvent(tenantId, id);
  if (!event) throw notFound('Downtime event');
  return eventDto(event);
}

/** Paginated, filtered list (line, machine, reason, open/closed, date range), newest first. */
export async function listEvents(tenantId, { line_id, machine_id, reason_id, status, from, to, page, limit }) {
  const where = inTenant(tenantId);
  const and = [];
  if (machine_id) where.machine_id = machine_id;
  if (reason_id) where.reason_id = reason_id;
  if (status === 'open') where.ended_at = null;
  if (status === 'closed') where.ended_at = { [Op.ne]: null };
  // Date range = events that overlap the range (an event spanning midnight shows on both days).
  if (from) and.push({ [Op.or]: [{ ended_at: null }, { ended_at: { [Op.gte]: from } }] });
  if (to) where.started_at = { [Op.lte]: to };
  if (and.length) where[Op.and] = and;

  // The line filter is a condition on the joined machine. The count only joins what the filters need,
  // while the page of rows loads every relation the response shows.
  const [total, rows] = await Promise.all([
    DowntimeEvent.count({
      where,
      ...(line_id && { include: [{ model: Machine, as: 'machine', attributes: [], required: true, where: { line_id } }] }),
    }),
    DowntimeEvent.findAll({
      where,
      include: eventInclude({ lineId: line_id }),
      order: [['started_at', 'DESC'], ['id', 'DESC']],
      limit,
      offset: (page - 1) * limit,
    }),
  ]);
  return { data: rows.map(eventDto), total, page, limit };
}

/** Starts (or, with `ended_at`, back-fills) a downtime event. `user` is the authenticated user. */
export async function startEvent(user, { machine_id, reason_id, started_at, ended_at, note }) {
  const { tenant_id: tenantId, id: userId } = user;

  // Machine and reason must belong to this tenant and be active (composite FKs also enforce tenancy in the DB).
  const [machine, reason] = await Promise.all([
    Machine.findOne({
      where: inTenant(tenantId, { id: machine_id }),
      include: [{ model: ProductionLine, as: 'line', attributes: ['active'] }],
    }),
    DowntimeReason.findOne({ where: inTenant(tenantId, { id: reason_id }) }),
  ]);
  if (!machine) throw new HttpError(400, 'Unknown machine');
  if (!reason) throw new HttpError(400, 'Unknown downtime reason');
  if (!machine.active || !machine.line.active || !reason.active) throw new HttpError(400, 'Machine, line or reason is inactive');

  // "A machine cannot have two open events". The explicit check gives a clear message; the partial unique index
  // and exclusion constraint remain the real guarantee when two requests race (their errors map to a 409 too).
  if (await DowntimeEvent.count({ where: { machine_id, ended_at: null } })) {
    throw new HttpError(409, 'This machine already has an open downtime event');
  }

  const created = await DowntimeEvent.create({
    tenant_id: tenantId, machine_id, reason_id,
    started_at: started_at ?? new Date(),
    ended_at: ended_at ?? null,
    note: note ?? null,
    created_by: userId,
  });
  return eventDto(await findEvent(tenantId, created.id));
}

/** Closes an open event (ended_at defaults to now). */
export async function closeEvent(tenantId, id, { ended_at, note } = {}) {
  const changes = { ended_at: ended_at ?? new Date(), ...(note !== undefined && { note }) };

  // Conditional UPDATE (`ended_at IS NULL`): two concurrent closes can't both succeed.
  const [closed] = await DowntimeEvent.update(changes, { where: inTenant(tenantId, { id, ended_at: null }) });
  if (!closed) {
    if (!(await findEvent(tenantId, id))) throw notFound('Downtime event');
    throw new HttpError(409, 'Event is already closed');
  }
  return eventDto(await findEvent(tenantId, id));
}

export async function updateEvent(tenantId, id, changes) {
  const [updated] = await DowntimeEvent.update(changes, { where: inTenant(tenantId, { id }) });
  if (!updated) throw notFound('Downtime event');
  return eventDto(await findEvent(tenantId, id));
}

export async function deleteEvent(tenantId, id) {
  const event = await findOwned(DowntimeEvent, tenantId, id, 'Downtime event');
  await event.destroy();
}
