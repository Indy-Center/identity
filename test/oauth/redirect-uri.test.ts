import { describe, expect, it } from 'vitest';
import {
	isAllowedOrigin,
	isAllowedRedirectUri,
	validateReturnUrl
} from '../../src/oauth/redirect-uri';
import { IdentityError } from '../../src/client/errors';

describe('isAllowedRedirectUri', () => {
	it('accepts https flyindycenter.com subdomains and the apex', () => {
		expect(isAllowedRedirectUri('https://charts.flyindycenter.com/kind?x=1')).toBe(true);
		expect(isAllowedRedirectUri('https://flyindycenter.com/')).toBe(true);
		expect(isAllowedRedirectUri('https://flyindycenter.com')).toBe(true);
	});

	it('accepts http loopback hosts on any port', () => {
		expect(isAllowedRedirectUri('http://localhost:5173/')).toBe(true);
		expect(isAllowedRedirectUri('http://localhost/x')).toBe(true);
		expect(isAllowedRedirectUri('http://127.0.0.1:8080/foo')).toBe(true);
		expect(isAllowedRedirectUri('http://[::1]:5173/')).toBe(true);
	});

	it('rejects off-domain URLs and lookalikes', () => {
		expect(isAllowedRedirectUri('https://evil.com/x')).toBe(false);
		expect(isAllowedRedirectUri('https://flyindycenter.com.evil.com/')).toBe(false);
		expect(isAllowedRedirectUri('https://notflyindycenter.com/')).toBe(false);
		expect(isAllowedRedirectUri('http://localhost.evil.com/')).toBe(false);
	});

	it('rejects the wrong scheme for each host kind', () => {
		expect(isAllowedRedirectUri('http://charts.flyindycenter.com/')).toBe(false);
		expect(isAllowedRedirectUri('https://localhost:5173/')).toBe(false);
	});

	it('rejects a bare path and the empty string', () => {
		expect(isAllowedRedirectUri('/airports')).toBe(false);
		expect(isAllowedRedirectUri('')).toBe(false);
	});
});

describe('isAllowedOrigin', () => {
	it('allows bare production and loopback origins', () => {
		expect(isAllowedOrigin('https://charts.flyindycenter.com')).toBe(true);
		expect(isAllowedOrigin('https://flyindycenter.com')).toBe(true);
		expect(isAllowedOrigin('http://localhost:5173')).toBe(true);
		expect(isAllowedOrigin('http://[::1]:3000')).toBe(true);
	});

	it('rejects everything else', () => {
		expect(isAllowedOrigin('https://evil.com')).toBe(false);
		expect(isAllowedOrigin('https://flyindycenter.com.evil.com')).toBe(false);
		expect(isAllowedOrigin('http://charts.flyindycenter.com')).toBe(false);
		expect(isAllowedOrigin('')).toBe(false);
	});
});

describe('validateReturnUrl', () => {
	it('returns an allowed URL unchanged', () => {
		expect(validateReturnUrl('https://charts.flyindycenter.com/')).toBe(
			'https://charts.flyindycenter.com/'
		);
		expect(validateReturnUrl('http://localhost:5173/x')).toBe('http://localhost:5173/x');
	});

	it('throws invalid_return_url when missing', () => {
		expect(() => validateReturnUrl(undefined)).toThrow(IdentityError);
		expect(() => validateReturnUrl('')).toThrow(IdentityError);
	});

	it('throws invalid_return_url when disallowed', () => {
		try {
			validateReturnUrl('https://evil.com/');
			expect.unreachable();
		} catch (e) {
			expect(e).toBeInstanceOf(IdentityError);
			expect((e as IdentityError).code).toBe('invalid_return_url');
			expect((e as IdentityError).status).toBe(400);
		}
	});
});
