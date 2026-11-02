import { Router } from 'express';
import { z } from 'zod';
import { authenticate, authorize, requireTenant } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import * as reportService from '../services/reportService.js';
import { wrap } from '../utils/errors.js';

const router = Router();
router.use(authenticate, requireTenant, authorize('admin'));

const DAY_MS = 864e5;
const rangeQuery = z.object({
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
}).transform((v) => {
  const to = v.to ?? new Date();
  return { from: v.from ?? new Date(to.getTime() - 7 * DAY_MS), to }; // default: last 7 days
}).refine((v) => v.from < v.to, { message: '"from" must be before "to"', path: ['from'] });

router.get('/summary', validate(rangeQuery, 'query'), wrap(async (req, res) => {
  res.json(await reportService.downtimeSummary(req.user.tenant_id, req.query.from, req.query.to));
}));

export default router;
