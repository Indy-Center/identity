// src/error-handler.ts
import type { ErrorHandler, NotFoundHandler } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { IdentityError } from './errors';

export const errorHandler: ErrorHandler = (err, c) => {
	if (err instanceof IdentityError) {
		return c.json({ error: { code: err.code, message: err.message } }, err.status as 400);
	}
	// Hono's own 4xx, e.g. the json validator's "Malformed JSON in request body".
	if (err instanceof HTTPException && err.status < 500) {
		return c.json({ error: { code: 'validation_failed', message: err.message } }, err.status);
	}
	console.error('unhandled error', err);
	return c.json({ error: { code: 'internal', message: 'internal error' } }, 500);
};

export const notFoundHandler: NotFoundHandler = (c) =>
	c.json({ error: { code: 'not_found', message: 'no such route' } }, 404);
