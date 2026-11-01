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
const name = z.string().trim().min(1).max(100);
const listQuery = z.object({ line_id: id.optional() });
const createSchema = z.object({ line_id: id, name });
const updateSchema = z.object({ name: name.optional(), line_id: id.optional(), active: z.boolean().optional() })
  .refine((v) => Object.keys(v).length > 0, 'Provide at least one field');

const SELECT = `
  SELECT m.id, m.name, m.active, m.line_id, l.name AS line_name,
         EXISTS (SELECT 1 FROM downtime_events e WHERE e.machine_id = m.id AND e.ended_at IS NULL) AS is_down
    FROM machines m JOIN production_lines l ON l.id = m.line_id`;

async function assertLineOwned(tenantId, lineId) {
  const r = await query('SELECT 1 FROM production_lines WHERE id = $1 AND tenant_id = $2', [lineId, tenantId]);
  if (!r.rowCount) throw new HttpError(400, 'Unknown production line');
}

router.get('/', validate(listQuery, 'query'), wrap(async (req, res) => {
  const { rows } = await query(
    `${SELECT} WHERE m.tenant_id = $1 AND ($2::int IS NULL OR m.line_id = $2) ORDER BY l.name, m.name`,
    [req.user.tenant_id, req.query.line_id ?? null]
  );
  res.json({ data: rows });
}));

router.post('/', authorize('admin'), validate(createSchema), wrap(async (req, res) => {
  await assertLineOwned(req.user.tenant_id, req.body.line_id);
  const { rows } = await query(
    'INSERT INTO machines (tenant_id, line_id, name) VALUES ($1,$2,$3) RETURNING id',
    [req.user.tenant_id, req.body.line_id, req.body.name]
  );
  res.status(201).json((await query(`${SELECT} WHERE m.id = $1`, [rows[0].id])).rows[0]);
}));

router.patch('/:id', authorize('admin'), validate(idParam, 'params'), validate(updateSchema), wrap(async (req, res) => {
  const { name, line_id, active } = req.body;
  if (line_id) await assertLineOwned(req.user.tenant_id, line_id);
  const { rows } = await query(
    `UPDATE machines SET name = COALESCE($3, name), line_id = COALESCE($4, line_id), active = COALESCE($5, active)
      WHERE id = $1 AND tenant_id = $2 RETURNING id`,
    [req.params.id, req.user.tenant_id, name ?? null, line_id ?? null, active ?? null]
  );
  if (!rows[0]) throw notFound('Machine');
  res.json((await query(`${SELECT} WHERE m.id = $1`, [rows[0].id])).rows[0]);
}));

// Fails with 409 if the machine has downtime history (foreign key); deactivate instead.
router.delete('/:id', authorize('admin'), validate(idParam, 'params'), wrap(async (req, res) => {
  const r = await query('DELETE FROM machines WHERE id = $1 AND tenant_id = $2', [req.params.id, req.user.tenant_id]);
  if (!r.rowCount) throw notFound('Machine');
  res.status(204).end();
}));

export default router;
