import { Router } from 'express';
import { z } from 'zod';
import { authenticate, authorize, requireTenant } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import * as reasonService from '../services/reasonService.js';
import { wrap } from '../utils/errors.js';

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
  res.json({ data: await reasonService.listReasons(req.user.tenant_id) });
}));

router.post('/', authorize('admin'), validate(createSchema), wrap(async (req, res) => {
  res.status(201).json(await reasonService.createReason(req.user.tenant_id, req.body));
}));

router.patch('/:id', authorize('admin'), validate(idParam, 'params'), validate(updateSchema), wrap(async (req, res) => {
  res.json(await reasonService.updateReason(req.user.tenant_id, req.params.id, req.body));
}));

router.delete('/:id', authorize('admin'), validate(idParam, 'params'), wrap(async (req, res) => {
  await reasonService.deleteReason(req.user.tenant_id, req.params.id);
  res.status(204).end();
}));

export default router;
