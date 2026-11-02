import { Router } from 'express';
import { z } from 'zod';
import { authenticate, authorize, requireTenant } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import * as lineService from '../services/lineService.js';
import { wrap } from '../utils/errors.js';

const router = Router();
router.use(authenticate, requireTenant);

const idParam = z.object({ id: z.coerce.number().int().positive() });
const name = z.string().trim().min(1).max(100);
const createSchema = z.object({ name });
const updateSchema = z.object({ name: name.optional(), active: z.boolean().optional() })
  .refine((v) => Object.keys(v).length > 0, 'Provide at least one field');

// Readable by every role (operators need the lists for the event form); writes are admin-only.
router.get('/', wrap(async (req, res) => {
  res.json({ data: await lineService.listLines(req.user.tenant_id) });
}));

router.post('/', authorize('admin'), validate(createSchema), wrap(async (req, res) => {
  res.status(201).json(await lineService.createLine(req.user.tenant_id, req.body));
}));

router.patch('/:id', authorize('admin'), validate(idParam, 'params'), validate(updateSchema), wrap(async (req, res) => {
  res.json(await lineService.updateLine(req.user.tenant_id, req.params.id, req.body));
}));

router.delete('/:id', authorize('admin'), validate(idParam, 'params'), wrap(async (req, res) => {
  await lineService.deleteLine(req.user.tenant_id, req.params.id);
  res.status(204).end();
}));

export default router;
