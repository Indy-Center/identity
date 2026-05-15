import type { ErrorHandler } from 'hono';
import { IdentityError } from './lib/errors';

export const errorHandler: ErrorHandler = (err, c) => {
	if (err instanceof IdentityError) {
		return c.json({ error: { code: err.code, message: err.message } }, err.status as 400);
	}
	console.error('unhandled error', err);
	return c.json({ error: { code: 'internal', message: 'internal error' } }, 500);
};
