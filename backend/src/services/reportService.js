import { Op, col, fn, literal } from 'sequelize';
import { sequelize } from '../db.js';
import { DowntimeEvent, DowntimeReason, Machine, ProductionLine } from '../models/index.js';
import { inTenant } from '../utils/tenant.js';

const round1 = (n) => Math.round(Number(n) * 10) / 10;

// The aggregates run in PostgreSQL (SUM / COUNT / AVG over joins), expressed through the models.
// `sequelize.escape` renders the (already validated) dates as safe SQL literals.
function rangeFragments(from, to) {
  const F = `${sequelize.escape(from)}::timestamptz`;
  const T = `${sequelize.escape(to)}::timestamptz`;
  return {
    // minutes of each event that fall inside [from, to]; open events run until now
    clippedMinutes: literal(
      `EXTRACT(EPOCH FROM (LEAST(COALESCE("DowntimeEvent"."ended_at", now()), ${T}) - GREATEST("DowntimeEvent"."started_at", ${F}))) / 60`,
    ),
    // full length of a closed event (NULL for open ones, which AVG ignores)
    fullMinutes: literal('EXTRACT(EPOCH FROM ("DowntimeEvent"."ended_at" - "DowntimeEvent"."started_at")) / 60'),
    // events that overlap the range
    overlapWhere: (tenantId) => ({
      ...inTenant(tenantId),
      started_at: { [Op.lt]: to },
      [Op.or]: [
        { ended_at: { [Op.gt]: from } },
        { ended_at: null, [Op.and]: [literal(`now() > ${F}`)] },
      ],
    }),
  };
}

/** Downtime minutes by line and by reason (plus totals) for [from, to]. An event only counts the minutes inside the range. */
export async function downtimeSummary(tenantId, from, to) {
  const { clippedMinutes, fullMinutes, overlapWhere } = rangeFragments(from, to);
  const where = overlapWhere(tenantId);
  const eventCount = [fn('COUNT', col('DowntimeEvent.id')), 'events'];
  const totalMinutes = [fn('SUM', clippedMinutes), 'total_minutes'];

  const [totals, byLine, byReason] = await Promise.all([
    DowntimeEvent.findOne({
      where,
      attributes: [
        eventCount,
        [literal('COUNT(*) FILTER (WHERE "DowntimeEvent"."ended_at" IS NULL)'), 'open_events'],
        [fn('COALESCE', fn('SUM', clippedMinutes), 0), 'total_minutes'],
        [fn('AVG', fullMinutes), 'avg_minutes_per_closed_event'],
      ],
      raw: true,
    }),
    // events -> machine -> line, grouped by line
    DowntimeEvent.findAll({
      where,
      attributes: [eventCount, totalMinutes],
      include: [{
        model: Machine, as: 'machine', attributes: [], required: true,
        include: [{ model: ProductionLine, as: 'line', attributes: ['id', 'name'], required: true }],
      }],
      group: [col('machine->line.id'), col('machine->line.name')],
      order: [[literal('total_minutes'), 'DESC'], [col('machine->line.name'), 'ASC']],
      raw: true,
    }),
    // events -> reason, grouped by reason
    DowntimeEvent.findAll({
      where,
      attributes: [eventCount, totalMinutes],
      include: [{ model: DowntimeReason, as: 'reason', attributes: ['id', 'name', 'category'], required: true }],
      group: [col('reason.id'), col('reason.name'), col('reason.category')],
      order: [[literal('total_minutes'), 'DESC'], [col('reason.name'), 'ASC']],
      raw: true,
    }),
  ]);

  return {
    from,
    to,
    totals: {
      events: Number(totals.events),
      open_events: Number(totals.open_events),
      total_minutes: round1(totals.total_minutes),
      avg_minutes_per_closed_event: totals.avg_minutes_per_closed_event == null ? null : round1(totals.avg_minutes_per_closed_event),
    },
    by_line: byLine.map((r) => ({
      line_id: r['machine.line.id'], line_name: r['machine.line.name'],
      events: Number(r.events), total_minutes: round1(r.total_minutes),
    })),
    by_reason: byReason.map((r) => ({
      reason_id: r['reason.id'], reason_name: r['reason.name'], category: r['reason.category'],
      events: Number(r.events), total_minutes: round1(r.total_minutes),
    })),
  };
}
