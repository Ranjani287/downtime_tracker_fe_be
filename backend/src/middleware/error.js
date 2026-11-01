import { HttpError } from '../utils/errors.js';

export const notFoundHandler = (_req, _res, next) => next(new HttpError(404, 'Route not found'));

// Friendly messages for specific database constraints (keyed by constraint name).
const CONSTRAINT_MESSAGES = {
  uq_events_one_open_per_machine: [409, 'This machine already has an open downtime event'],
  ex_event_no_overlap: [409, 'This machine already has downtime overlapping that time range'],
  chk_event_times: [400, 'End time must be after start time'],
  uq_users_email: [409, 'A user with that email already exists'],
  production_lines_tenant_id_name_key: [409, 'A line with that name already exists'],
  machines_line_id_name_key: [409, 'A machine with that name already exists on this line'],
  downtime_reasons_tenant_id_name_key: [409, 'A reason with that name already exists'],
  tenants_name_key: [409, 'An organisation with that name already exists'],
};

// Maps known Postgres errors to friendly HTTP errors; hides internals for the rest.
export const errorHandler = (err, _req, res, _next) => {
  let { status, message, details } = err;

  if (!status) {
    const known = CONSTRAINT_MESSAGES[err.constraint];
    if (known) {
      [status, message] = known;
    } else {
      switch (err.code) {
        case '23P01': // exclusion_violation
        case '23505': // unique_violation
          status = 409;
          message = 'A record with those values already exists';
          break;
        case '23503': // foreign_key_violation
          status = 409;
          message = 'Referenced record does not exist or is still in use';
          break;
        case '23514': // check_violation
          status = 400;
          message = 'Invalid values';
          break;
        default:
          status = 500;
          message = 'Internal server error';
          console.error(err);
      }
    }
  }
  res.status(status).json({ error: message, ...(details && { details }) });
};
