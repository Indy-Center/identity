import { describe, expect, it } from 'vitest';
import { AppError } from '../../src/lib/errors';

describe('AppError', () => {
	it('exposes code, status, and message', () => {
		const e = new AppError('invalid_state', 400, 'state cookie missing');
		expect(e.code).toBe('invalid_state');
		expect(e.status).toBe(400);
		expect(e.message).toBe('state cookie missing');
		expect(e).toBeInstanceOf(Error);
	});
});
