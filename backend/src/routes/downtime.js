import { Router } from 'express';
import { z } from 'zod';
import { authenticate, authorize, requireTenant } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import * as downtimeService from '../services/downtimeService.js';
import { wrap } from '../utils/errors.js';

const router = Router();
router.use(authenticate, requireTenant);

const id = z.coerce.number().int().positive();
const idParam = z.object({ id });

// Allow a few minutes of clock skew between the browser and the server, but no real future timestamps.
const SKEW_MS = 5 * 60 * 1000;
const pastDate = z.coerce.date().refine((d) => d.getTime() <= Date.now() + SKEW_MS, 'Cannot be in the future');
const note = z.string().trim().max(1000);

const listQuery = z.object({
  line_id: id.optional(),
  machine_id: id.optional(),
  reason_id: id.optional(),
  status: z.enum(['open', 'closed']).optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
}).refine((v) => !v.from || !v.to || v.from <= v.to, { message: '"from" must not be after "to"', path: ['from'] });

const startSchema = z.object({
  machine_id: id,
  reason_id: id,
  started_at: pastDate.optional(), // defaults to now
  ended_at: pastDate.optional(),   // optional: lets an operator back-fill an event that already finished
  note: note.optional(),
}).refine((v) => !v.ended_at || v.ended_at > (v.started_at ?? new Date()), {
  message: 'ended_at must be after started_at', path: ['ended_at'],
});

const closeSchema = z.object({ ended_at: pastDate.optional(), note: note.optional() }).default({});

const updateSchema = z.object({
  reason_id: id.optional(),
  started_at: pastDate.optional(),
  ended_at: pastDate.nullable().optional(),
  note: note.nullable().optional(),
}).refine((v) => Object.keys(v).length > 0, 'Provide at least one field');

// Any tenant user can read the list, start events and close them.
router.get('/', validate(listQuery, 'query'), wrap(async (req, res) => {
  res.json(await downtimeService.listEvents(req.user.tenant_id, req.query));
}));

router.get('/:id', validate(idParam, 'params'), wrap(async (req, res) => {
  res.json(await downtimeService.getEvent(req.user.tenant_id, req.params.id));
}));

router.post('/', validate(startSchema), wrap(async (req, res) => {
  res.status(201).json(await downtimeService.startEvent(req.user, req.body));
}));

router.patch('/:id/close', validate(idParam, 'params'), validate(closeSchema), wrap(async (req, res) => {
  res.json(await downtimeService.closeEvent(req.user.tenant_id, req.params.id, req.body));
}));

// Corrections and deletions are admin-only.
router.put('/:id', authorize('admin'), validate(idParam, 'params'), validate(updateSchema), wrap(async (req, res) => {
  res.json(await downtimeService.updateEvent(req.user.tenant_id, req.params.id, req.body));
}));

router.delete('/:id', authorize('admin'), validate(idParam, 'params'), wrap(async (req, res) => {
  await downtimeService.deleteEvent(req.user.tenant_id, req.params.id);
  res.status(204).end();
}));

export default router;
