import { Router } from 'express';
import { z } from 'zod';
import { query } from '../db.js';
import { authenticate, authorize, requireTenant } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { notFound, wrap } from '../utils/errors.js';

const router = Router();
router.use(authenticate, requireTenant);

const idParam = z.object({ id: z.coerce.number().int().positive() });
const name = z.string().trim().min(1).max(100);
const createSchema = z.object({ name });
const updateSchema = z.object({ name: name.optional(), active: z.boolean().optional() })
  .refine((v) => Object.keys(v).length > 0, 'Provide at least one field');

// Readable by every role (operators need the lists for the event form); writes are admin-only.
router.get('/', wrap(async (req, res) => {
  const { rows } = await query(
    `SELECT l.id, l.name, l.active,
            (SELECT count(*)::int FROM machines m WHERE m.line_id = l.id) AS machine_count
       FROM production_lines l WHERE l.tenant_id = $1 ORDER BY l.name`,
    [req.user.tenant_id]
  );
  res.json({ data: rows });
}));

router.post('/', authorize('admin'), validate(createSchema), wrap(async (req, res) => {
  const { rows } = await query(
    'INSERT INTO production_lines (tenant_id, name) VALUES ($1,$2) RETURNING id, name, active',
    [req.user.tenant_id, req.body.name]
  );
  res.status(201).json(rows[0]);
}));

router.patch('/:id', authorize('admin'), validate(idParam, 'params'), validate(updateSchema), wrap(async (req, res) => {
  const { rows } = await query(
    `UPDATE production_lines SET name = COALESCE($3, name), active = COALESCE($4, active)
      WHERE id = $1 AND tenant_id = $2 RETURNING id, name, active`,
    [req.params.id, req.user.tenant_id, req.body.name ?? null, req.body.active ?? null]
  );
  if (!rows[0]) throw notFound('Line');
  res.json(rows[0]);
}));

// Fails with 409 if machines still belong to the line (foreign key); deactivate instead.
router.delete('/:id', authorize('admin'), validate(idParam, 'params'), wrap(async (req, res) => {
  const r = await query('DELETE FROM production_lines WHERE id = $1 AND tenant_id = $2', [req.params.id, req.user.tenant_id]);
  if (!r.rowCount) throw notFound('Line');
  res.status(204).end();
}));

export default router;
