import { describe, expect, it } from 'vitest';
import {
	IdentityError,
	isIdentityError,
	getIdentityErrorCode,
	getStatusForCode
} from '../../src/lib/errors';

describe('IdentityError', () => {
	it('carries code, status, message internally', () => {
		const e = new IdentityError('not_found', 404, 'user gone');
		expect(e.code).toBe('not_found');
		expect(e.status).toBe(404);
		expect(e.message).toBe('user gone');
	});

	it('defaults message to code when omitted', () => {
		const e = new IdentityError('internal', 500);
		expect(e.message).toBe('internal');
	});

	it('encodes the code in name so it survives the service-binding wire', () => {
		const e = new IdentityError('not_found', 404);
		expect(e.name).toBe('IdentityError:not_found');
	});
});

describe('isIdentityError', () => {
	it('matches an IdentityError instance (same realm)', () => {
		expect(isIdentityError(new IdentityError('not_found', 404))).toBe(true);
	});

	it('matches a plain object whose name starts with IdentityError: (wire-side scenario)', () => {
		expect(isIdentityError({ name: 'IdentityError:not_found', message: 'x' })).toBe(true);
	});

	it('rejects a plain Error', () => {
		expect(isIdentityError(new Error('boom'))).toBe(false);
	});

	it('rejects null and undefined', () => {
		expect(isIdentityError(null)).toBe(false);
		expect(isIdentityError(undefined)).toBe(false);
	});

	it("rejects an object whose name doesn't have the prefix", () => {
		expect(isIdentityError({ name: 'SomeOtherError', message: 'x' })).toBe(false);
	});
});

describe('getIdentityErrorCode', () => {
	it('returns the code from an IdentityError instance', () => {
		expect(getIdentityErrorCode(new IdentityError('validation_failed', 400))).toBe(
			'validation_failed'
		);
	});

	it('parses the code from a wire-side object', () => {
		expect(getIdentityErrorCode({ name: 'IdentityError:not_found', message: 'x' })).toBe(
			'not_found'
		);
	});

	it('returns null for non-identity errors', () => {
		expect(getIdentityErrorCode(new Error('boom'))).toBeNull();
		expect(getIdentityErrorCode(null)).toBeNull();
		expect(getIdentityErrorCode({ name: 'TypeError', message: 'x' })).toBeNull();
	});
});

describe('getStatusForCode', () => {
	it('returns 404 for not_found', () => {
		expect(getStatusForCode('not_found')).toBe(404);
	});

	it('returns 400 for validation_failed', () => {
		expect(getStatusForCode('validation_failed')).toBe(400);
	});

	it('returns 401 for unauthenticated', () => {
		expect(getStatusForCode('unauthenticated')).toBe(401);
	});

	it('returns 403 for access_denied', () => {
		expect(getStatusForCode('access_denied')).toBe(403);
	});

	it('returns 502 for oauth_exchange_failed', () => {
		expect(getStatusForCode('oauth_exchange_failed')).toBe(502);
	});

	it('returns 500 for internal', () => {
		expect(getStatusForCode('internal')).toBe(500);
	});
});
