import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { pool, query } from '../db.js';
import { authenticate, authorize } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { notFound, wrap } from '../utils/errors.js';

// Platform administration: only the super admin (who belongs to no organisation) can use these.
const router = Router();
router.use(authenticate, authorize('super_admin'));

const idParam = z.object({ id: z.coerce.number().int().positive() });
const adminSchema = z.object({
  name: z.string().trim().min(1).max(100),
  email: z.string().trim().toLowerCase().email(),
  password: z.string().min(8).max(100),
});
const createOrgSchema = z.object({
  name: z.string().trim().min(1).max(100),
  admin: adminSchema,
});
const updateOrgSchema = z.object({
  name: z.string().trim().min(1).max(100).optional(),
  active: z.boolean().optional(),
}).refine((v) => Object.keys(v).length > 0, 'Provide at least one field');

const ORG_SELECT = `
  SELECT t.id, t.name, t.active, t.created_at,
         count(u.id)::int AS user_count,
         count(u.id) FILTER (WHERE u.role = 'admin')::int AS admin_count
    FROM tenants t LEFT JOIN users u ON u.tenant_id = t.id`;

router.get('/organisations', wrap(async (_req, res) => {
  const { rows } = await query(`${ORG_SELECT} GROUP BY t.id ORDER BY t.name`);
  res.json({ data: rows });
}));

// Creates the organisation and its first admin atomically.
router.post('/organisations', validate(createOrgSchema), wrap(async (req, res) => {
  const { name, admin } = req.body;
  const hash = await bcrypt.hash(admin.password, 10);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const org = (await client.query('INSERT INTO tenants (name) VALUES ($1) RETURNING id, name, active', [name])).rows[0];
    const user = (await client.query(
      `INSERT INTO users (tenant_id, email, name, password_hash, role)
       VALUES ($1,$2,$3,$4,'admin') RETURNING id, email, name, role`,
      [org.id, admin.email, admin.name, hash]
    )).rows[0];
    await client.query('COMMIT');
    res.status(201).json({ ...org, admin: user });
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}));

router.patch('/organisations/:id', validate(idParam, 'params'), validate(updateOrgSchema), wrap(async (req, res) => {
  const { name, active } = req.body;
  const { rows } = await query(
    `UPDATE tenants SET name = COALESCE($2, name), active = COALESCE($3, active)
      WHERE id = $1 RETURNING id, name, active`,
    [req.params.id, name ?? null, active ?? null]
  );
  if (!rows[0]) throw notFound('Organisation');
  res.json(rows[0]);
}));

router.get('/organisations/:id/users', validate(idParam, 'params'), wrap(async (req, res) => {
  const org = await query('SELECT id FROM tenants WHERE id = $1', [req.params.id]);
  if (!org.rowCount) throw notFound('Organisation');
  const { rows } = await query(
    'SELECT id, name, email, role, active FROM users WHERE tenant_id = $1 ORDER BY role, name',
    [req.params.id]
  );
  res.json({ data: rows });
}));

// Add another admin to an existing organisation (e.g. if the first one leaves).
router.post('/organisations/:id/admins', validate(idParam, 'params'), validate(adminSchema), wrap(async (req, res) => {
  const { name, email, password } = req.body;
  const org = await query('SELECT id FROM tenants WHERE id = $1', [req.params.id]);
  if (!org.rowCount) throw notFound('Organisation');
  const { rows } = await query(
    `INSERT INTO users (tenant_id, email, name, password_hash, role)
     VALUES ($1,$2,$3,$4,'admin') RETURNING id, email, name, role, active`,
    [req.params.id, email, name, await bcrypt.hash(password, 10)]
  );
  res.status(201).json(rows[0]);
}));

export default router;
