import { Router } from 'express';
import { z } from 'zod';
import { query } from '../db.js';
import { authenticate, authorize, requireTenant } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { HttpError, notFound, wrap } from '../utils/errors.js';

const router = Router();
router.use(authenticate, requireTenant);

const id = z.coerce.number().int().positive();
const idParam = z.object({ id });

// Allow a few minutes of clock skew between the browser and the server, but no real future timestamps.
const SKEW_MS = 5 * 60 * 1000;
const pastDate = z.coerce.date().refine((d) => d.getTime() <= Date.now() + SKEW_MS, 'Cannot be in the future');
const note = z.string().trim().max(1000);

const listQuery = z.object({
  line_id: id.optional(),
  machine_id: id.optional(),
  reason_id: id.optional(),
  status: z.enum(['open', 'closed']).optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
}).refine((v) => !v.from || !v.to || v.from <= v.to, { message: '"from" must not be after "to"', path: ['from'] });

const startSchema = z.object({
  machine_id: id,
  reason_id: id,
  started_at: pastDate.optional(), // defaults to now
  ended_at: pastDate.optional(),   // optional: lets an operator back-fill an event that already finished
  note: note.optional(),
}).refine((v) => !v.ended_at || v.ended_at > (v.started_at ?? new Date()), {
  message: 'ended_at must be after started_at', path: ['ended_at'],
});

const closeSchema = z.object({ ended_at: pastDate.optional(), note: note.optional() }).default({});

const updateSchema = z.object({
  reason_id: id.optional(),
  started_at: pastDate.optional(),
  ended_at: pastDate.nullable().optional(),
  note: note.nullable().optional(),
}).refine((v) => Object.keys(v).length > 0, 'Provide at least one field');

const SELECT = `
  SELECT e.id, e.machine_id, m.name AS machine_name, m.line_id, l.name AS line_name,
         e.reason_id, r.name AS reason_name, r.category AS reason_category,
         e.started_at, e.ended_at, e.note, e.created_by, u.name AS created_by_name,
         ROUND((EXTRACT(EPOCH FROM (COALESCE(e.ended_at, now()) - e.started_at)) / 60)::numeric, 1)::float8 AS duration_minutes
    FROM downtime_events e
    JOIN machines m          ON m.id = e.machine_id
    JOIN production_lines l  ON l.id = m.line_id
    JOIN downtime_reasons r  ON r.id = e.reason_id
    JOIN users u             ON u.id = e.created_by`;

const getOne = async (tenantId, eventId) =>
  (await query(`${SELECT} WHERE e.tenant_id = $1 AND e.id = $2`, [tenantId, eventId])).rows[0];

// Any tenant user can read the list.
router.get('/', validate(listQuery, 'query'), wrap(async (req, res) => {
  const { line_id, machine_id, reason_id, status, from, to, page, limit } = req.query;
  const where = ['e.tenant_id = $1'];
  const params = [req.user.tenant_id];
  const add = (sql, val) => { params.push(val); where.push(sql.replace('?', `$${params.length}`)); };

  if (line_id) add('m.line_id = ?', line_id);
  if (machine_id) add('e.machine_id = ?', machine_id);
  if (reason_id) add('e.reason_id = ?', reason_id);
  if (status === 'open') where.push('e.ended_at IS NULL');
  if (status === 'closed') where.push('e.ended_at IS NOT NULL');
  // Date range = events that overlap the range (an event spanning midnight shows on both days).
  if (from) add("COALESCE(e.ended_at, 'infinity'::timestamptz) >= ?", from);
  if (to) add('e.started_at <= ?', to);

  const base = `FROM downtime_events e JOIN machines m ON m.id = e.machine_id WHERE ${where.join(' AND ')}`;
  const total = await query(`SELECT count(*)::int AS n ${base}`, params);
  // limit/offset are Zod-validated integers, safe to inline
  const { rows } = await query(
    `${SELECT} WHERE ${where.join(' AND ')} ORDER BY e.started_at DESC, e.id DESC LIMIT ${limit} OFFSET ${(page - 1) * limit}`,
    params
  );
  res.json({ data: rows, total: total.rows[0].n, page, limit });
}));

router.get('/:id', validate(idParam, 'params'), wrap(async (req, res) => {
  const row = await getOne(req.user.tenant_id, req.params.id);
  if (!row) throw notFound('Downtime event');
  res.json(row);
}));

// Start a downtime event. Operators (and admins) can log events.
router.post('/', validate(startSchema), wrap(async (req, res) => {
  const { machine_id, reason_id, started_at, ended_at, note: text } = req.body;
  const { tenant_id, id: userId } = req.user;

  // Machine and reason must belong to this tenant and be active (composite FKs also enforce tenancy in the DB).
  const [machine, reason] = await Promise.all([
    query(
      `SELECT (m.active AND l.active) AS active FROM machines m JOIN production_lines l ON l.id = m.line_id
        WHERE m.id = $1 AND m.tenant_id = $2`, [machine_id, tenant_id]),
    query('SELECT active FROM downtime_reasons WHERE id = $1 AND tenant_id = $2', [reason_id, tenant_id]),
  ]);
  if (!machine.rows[0]) throw new HttpError(400, 'Unknown machine');
  if (!reason.rows[0]) throw new HttpError(400, 'Unknown downtime reason');
  if (!machine.rows[0].active || !reason.rows[0].active) throw new HttpError(400, 'Machine, line or reason is inactive');

  // "A machine cannot have two open events". The explicit check gives a clear message; the partial unique index
  // and exclusion constraint remain the real guarantee when two requests race (their errors map to a 409 too).
  const open = await query('SELECT 1 FROM downtime_events WHERE machine_id = $1 AND ended_at IS NULL', [machine_id]);
  if (open.rowCount) throw new HttpError(409, 'This machine already has an open downtime event');

  const { rows } = await query(
    `INSERT INTO downtime_events (tenant_id, machine_id, reason_id, started_at, ended_at, note, created_by)
     VALUES ($1,$2,$3, COALESCE($4, now()), $5, $6, $7) RETURNING id`,
    [tenant_id, machine_id, reason_id, started_at ?? null, ended_at ?? null, text ?? null, userId]
  );
  res.status(201).json(await getOne(tenant_id, rows[0].id));
}));

// Close an open event. Operators (and admins) can close events.
router.patch('/:id/close', validate(idParam, 'params'), validate(closeSchema), wrap(async (req, res) => {
  const { ended_at, note: text } = req.body;
  const { rows } = await query(
    `UPDATE downtime_events SET ended_at = COALESCE($3, now()), note = COALESCE($4, note)
      WHERE id = $1 AND tenant_id = $2 AND ended_at IS NULL RETURNING id`,
    [req.params.id, req.user.tenant_id, ended_at ?? null, text ?? null]
  );
  if (!rows[0]) {
    if (!(await getOne(req.user.tenant_id, req.params.id))) throw notFound('Downtime event');
    throw new HttpError(409, 'Event is already closed');
  }
  res.json(await getOne(req.user.tenant_id, rows[0].id));
}));

// Corrections and deletions are admin-only.
router.put('/:id', authorize('admin'), validate(idParam, 'params'), validate(updateSchema), wrap(async (req, res) => {
  const sets = [];
  const params = [req.params.id, req.user.tenant_id];
  for (const col of ['reason_id', 'started_at', 'ended_at', 'note']) {
    if (col in req.body) { params.push(req.body[col]); sets.push(`${col} = $${params.length}`); }
  }
  const { rows } = await query(
    `UPDATE downtime_events SET ${sets.join(', ')} WHERE id = $1 AND tenant_id = $2 RETURNING id`, params
  );
  if (!rows[0]) throw notFound('Downtime event');
  res.json(await getOne(req.user.tenant_id, rows[0].id));
}));

router.delete('/:id', authorize('admin'), validate(idParam, 'params'), wrap(async (req, res) => {
  const r = await query('DELETE FROM downtime_events WHERE id = $1 AND tenant_id = $2', [req.params.id, req.user.tenant_id]);
  if (!r.rowCount) throw notFound('Downtime event');
  res.status(204).end();
}));

export default router;
