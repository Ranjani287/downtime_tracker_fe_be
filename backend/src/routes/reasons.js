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
const category = z.string().trim().min(1).max(50); // free text, e.g. Breakdown, Changeover, Material
const createSchema = z.object({ name, category });
const updateSchema = z.object({ name: name.optional(), category: category.optional(), active: z.boolean().optional() })
  .refine((v) => Object.keys(v).length > 0, 'Provide at least one field');

// Readable by every role (operators need the list for the event form); writes are admin-only.
router.get('/', wrap(async (req, res) => {
  const { rows } = await query(
    'SELECT id, name, category, active FROM downtime_reasons WHERE tenant_id = $1 ORDER BY category, name',
    [req.user.tenant_id]
  );
  res.json({ data: rows });
}));

router.post('/', authorize('admin'), validate(createSchema), wrap(async (req, res) => {
  const { rows } = await query(
    'INSERT INTO downtime_reasons (tenant_id, name, category) VALUES ($1,$2,$3) RETURNING id, name, category, active',
    [req.user.tenant_id, req.body.name, req.body.category]
  );
  res.status(201).json(rows[0]);
}));

router.patch('/:id', authorize('admin'), validate(idParam, 'params'), validate(updateSchema), wrap(async (req, res) => {
  const { name, category, active } = req.body;
  const { rows } = await query(
    `UPDATE downtime_reasons
        SET name = COALESCE($3, name), category = COALESCE($4, category), active = COALESCE($5, active)
      WHERE id = $1 AND tenant_id = $2 RETURNING id, name, category, active`,
    [req.params.id, req.user.tenant_id, name ?? null, category ?? null, active ?? null]
  );
  if (!rows[0]) throw notFound('Reason');
  res.json(rows[0]);
}));

router.delete('/:id', authorize('admin'), validate(idParam, 'params'), wrap(async (req, res) => {
  const r = await query('DELETE FROM downtime_reasons WHERE id = $1 AND tenant_id = $2', [req.params.id, req.user.tenant_id]);
  if (!r.rowCount) throw notFound('Reason');
  res.status(204).end();
}));

export default router;
