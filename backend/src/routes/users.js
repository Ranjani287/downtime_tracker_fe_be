import { Router } from 'express';
import { z } from 'zod';
import { authenticate, authorize, requireTenant } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import * as userService from '../services/userService.js';
import { wrap } from '../utils/errors.js';

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
  res.json({ data: await userService.listUsers(req.user.tenant_id) });
}));

router.post('/', validate(createSchema), wrap(async (req, res) => {
  res.status(201).json(await userService.createUser(req.user.tenant_id, req.body));
}));

router.patch('/:id', validate(idParam, 'params'), validate(updateSchema), wrap(async (req, res) => {
  res.json(await userService.updateUser(req.user, req.params.id, req.body));
}));

export default router;
