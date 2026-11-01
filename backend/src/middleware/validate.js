import { HttpError } from '../utils/errors.js';

// validate(schema, 'body' | 'query' | 'params') -> replaces req[source] with parsed data
export const validate = (schema, source = 'body') => (req, _res, next) => {
  const result = schema.safeParse(req[source]);
  if (!result.success) {
    const details = result.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message }));
    return next(new HttpError(400, 'Validation failed', details));
  }
  Object.defineProperty(req, source, { value: result.data, writable: true, configurable: true });
  next();
};
