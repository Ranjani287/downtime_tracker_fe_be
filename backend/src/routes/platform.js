import { Router } from 'express';
import { z } from 'zod';
import { authenticate, authorize } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import * as organisationService from '../services/organisationService.js';
import { wrap } from '../utils/errors.js';

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

router.get('/organisations', wrap(async (_req, res) => {
  res.json({ data: await organisationService.listOrganisations() });
}));

router.post('/organisations', validate(createOrgSchema), wrap(async (req, res) => {
  res.status(201).json(await organisationService.createOrganisation(req.body));
}));

router.patch('/organisations/:id', validate(idParam, 'params'), validate(updateOrgSchema), wrap(async (req, res) => {
  res.json(await organisationService.updateOrganisation(req.params.id, req.body));
}));

router.get('/organisations/:id/users', validate(idParam, 'params'), wrap(async (req, res) => {
  res.json({ data: await organisationService.listOrganisationUsers(req.params.id) });
}));

router.post('/organisations/:id/admins', validate(idParam, 'params'), validate(adminSchema), wrap(async (req, res) => {
  res.status(201).json(await organisationService.addOrganisationAdmin(req.params.id, req.body));
}));

export default router;
