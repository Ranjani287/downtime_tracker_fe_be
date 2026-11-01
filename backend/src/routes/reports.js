import { Router } from 'express';
import { z } from 'zod';
import { query } from '../db.js';
import { authenticate, authorize, requireTenant } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { wrap } from '../utils/errors.js';

const router = Router();
router.use(authenticate, requireTenant, authorize('admin'));

const DAY_MS = 864e5;
const rangeQuery = z.object({
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
}).transform((v) => {
  const to = v.to ?? new Date();
  return { from: v.from ?? new Date(to.getTime() - 7 * DAY_MS), to }; // default: last 7 days
}).refine((v) => v.from < v.to, { message: '"from" must be before "to"', path: ['from'] });

// Every event that overlaps [from, to], with its duration clipped to the range (open events run until now).
// So an event that started before the range only contributes the minutes that fall inside it.
const CLIPPED = `
  WITH clipped AS (
    SELECT e.machine_id, e.reason_id, (e.ended_at IS NULL) AS is_open,
           EXTRACT(EPOCH FROM (LEAST(COALESCE(e.ended_at, now()), $3::timestamptz) - GREATEST(e.started_at, $2::timestamptz))) / 60 AS minutes,
           EXTRACT(EPOCH FROM (e.ended_at - e.started_at)) / 60 AS full_minutes
      FROM downtime_events e
     WHERE e.tenant_id = $1
       AND e.started_at < $3::timestamptz
       AND COALESCE(e.ended_at, now()) > $2::timestamptz
  )`;

// Totals computed with joins + aggregates in SQL (not in JavaScript).
router.get('/summary', validate(rangeQuery, 'query'), wrap(async (req, res) => {
  const { from, to } = req.query;
  const params = [req.user.tenant_id, from, to];

  const [totals, byLine, byReason] = await Promise.all([
    query(
      `${CLIPPED}
       SELECT count(*)::int AS events,
              count(*) FILTER (WHERE is_open)::int AS open_events,
              COALESCE(ROUND(SUM(minutes)::numeric, 1), 0)::float8 AS total_minutes,
              ROUND(AVG(full_minutes)::numeric, 1)::float8 AS avg_minutes_per_closed_event
         FROM clipped`, params),
    query(
      `${CLIPPED}
       SELECT l.id AS line_id, l.name AS line_name, count(*)::int AS events,
              ROUND(SUM(c.minutes)::numeric, 1)::float8 AS total_minutes
         FROM clipped c
         JOIN machines m         ON m.id = c.machine_id
         JOIN production_lines l ON l.id = m.line_id
        GROUP BY l.id, l.name
        ORDER BY total_minutes DESC, l.name`, params),
    query(
      `${CLIPPED}
       SELECT r.id AS reason_id, r.name AS reason_name, r.category, count(*)::int AS events,
              ROUND(SUM(c.minutes)::numeric, 1)::float8 AS total_minutes
         FROM clipped c
         JOIN downtime_reasons r ON r.id = c.reason_id
        GROUP BY r.id, r.name, r.category
        ORDER BY total_minutes DESC, r.name`, params),
  ]);

  res.json({
    from, to,
    totals: totals.rows[0],
    by_line: byLine.rows,
    by_reason: byReason.rows,
  });
}));

export default router;
