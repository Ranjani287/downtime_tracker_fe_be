import { Router } from 'express';
import { z } from 'zod';
import { authenticate, authorize, requireTenant } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import * as machineService from '../services/machineService.js';
import { wrap } from '../utils/errors.js';

const router = Router();
router.use(authenticate, requireTenant);

const id = z.coerce.number().int().positive();
const idParam = z.object({ id });
const name = z.string().trim().min(1).max(100);
const listQuery = z.object({ line_id: id.optional() });
const createSchema = z.object({ line_id: id, name });
const updateSchema = z.object({ name: name.optional(), line_id: id.optional(), active: z.boolean().optional() })
  .refine((v) => Object.keys(v).length > 0, 'Provide at least one field');

router.get('/', validate(listQuery, 'query'), wrap(async (req, res) => {
  res.json({ data: await machineService.listMachines(req.user.tenant_id, req.query) });
}));

router.post('/', authorize('admin'), validate(createSchema), wrap(async (req, res) => {
  res.status(201).json(await machineService.createMachine(req.user.tenant_id, req.body));
}));

router.patch('/:id', authorize('admin'), validate(idParam, 'params'), validate(updateSchema), wrap(async (req, res) => {
  res.json(await machineService.updateMachine(req.user.tenant_id, req.params.id, req.body));
}));

router.delete('/:id', authorize('admin'), validate(idParam, 'params'), wrap(async (req, res) => {
  await machineService.deleteMachine(req.user.tenant_id, req.params.id);
  res.status(204).end();
}));

export default router;
