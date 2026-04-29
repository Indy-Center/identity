import type { ErrorHandler } from 'hono';
import { AppError } from '../lib/errors';

function isAppError(err: unknown): err is AppError {
	if (err == null || typeof err !== 'object') return false;
	const e = err as Record<string, unknown>;
	return (
		typeof e['code'] === 'string' &&
		typeof e['status'] === 'number' &&
		typeof e['message'] === 'string'
	);
}

export const errorHandler: ErrorHandler = (err, c) => {
	if (err instanceof AppError || isAppError(err)) {
		const e = err as AppError;
		return c.json({ error: { code: e.code, message: e.message } }, e.status as 400);
	}
	console.error('unhandled error', err);
	return c.json({ error: { code: 'internal', message: 'internal error' } }, 500);
};
