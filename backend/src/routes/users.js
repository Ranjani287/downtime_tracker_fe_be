import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { query } from '../db.js';
import { authenticate, authorize, requireTenant } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { HttpError, notFound, wrap } from '../utils/errors.js';

// Organisation admins manage the users of their own organisation only.
const router = Router();
router.use(authenticate, requireTenant, authorize('admin'));

const ROLES = ['admin', 'operator'];
const idParam = z.object({ id: z.coerce.number().int().positive() });
const createSchema = z.object({
  name: z.string().trim().min(1).max(100),
  email: z.string().trim().toLowerCase().email(),
  password: z.string().min(8).max(100),
  role: z.enum(ROLES),
});
const updateSchema = z.object({
  name: z.string().trim().min(1).max(100).optional(),
  role: z.enum(ROLES).optional(),
  active: z.boolean().optional(),
  password: z.string().min(8).max(100).optional(),
}).refine((v) => Object.keys(v).length > 0, 'Provide at least one field');

router.get('/', wrap(async (req, res) => {
  const { rows } = await query(
    'SELECT id, name, email, role, active FROM users WHERE tenant_id = $1 ORDER BY role, name',
    [req.user.tenant_id]
  );
  res.json({ data: rows });
}));

router.post('/', validate(createSchema), wrap(async (req, res) => {
  const { name, email, password, role } = req.body;
  const { rows } = await query(
    `INSERT INTO users (tenant_id, email, name, password_hash, role)
     VALUES ($1,$2,$3,$4,$5) RETURNING id, name, email, role, active`,
    [req.user.tenant_id, email, name, await bcrypt.hash(password, 10), role]
  );
  res.status(201).json(rows[0]);
}));

router.patch('/:id', validate(idParam, 'params'), validate(updateSchema), wrap(async (req, res) => {
  const { name, role, active, password } = req.body;
  // Prevent an admin from locking themselves out of their organisation.
  if (req.params.id === req.user.id && (active === false || (role && role !== 'admin'))) {
    throw new HttpError(400, 'You cannot deactivate or demote yourself');
  }
  const { rows } = await query(
    `UPDATE users SET name = COALESCE($3, name), role = COALESCE($4, role),
                      active = COALESCE($5, active), password_hash = COALESCE($6, password_hash)
      WHERE id = $1 AND tenant_id = $2
  RETURNING id, name, email, role, active`,
    [req.params.id, req.user.tenant_id, name ?? null, role ?? null, active ?? null,
      password ? await bcrypt.hash(password, 10) : null]
  );
  if (!rows[0]) throw notFound('User');
  // Deactivation or a password reset must end the user's existing sessions.
  if (active === false || password) {
    await query('UPDATE refresh_tokens SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL', [rows[0].id]);
  }
  res.json(rows[0]);
}));

export default router;
