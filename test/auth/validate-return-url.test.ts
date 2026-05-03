import { describe, expect, it } from 'vitest';
import { validateReturnUrl } from '../../src/auth/routes';
import { IdentityError } from '../../src/client/errors';

function makeEnv(cookieDomain: string): Cloudflare.Env {
	return { COOKIE_DOMAIN: cookieDomain } as unknown as Cloudflare.Env;
}

describe('validateReturnUrl', () => {
	describe('production mode (COOKIE_DOMAIN=.flyindycenter.com)', () => {
		const env = makeEnv('.flyindycenter.com');

		it('returns null for undefined input', () => {
			expect(validateReturnUrl(env, undefined)).toBeNull();
		});

		it('accepts a valid .flyindycenter.com URL', () => {
			expect(validateReturnUrl(env, 'https://app.flyindycenter.com/dashboard')).toBe(
				'https://app.flyindycenter.com/dashboard'
			);
		});

		it('rejects http://localhost in prod mode', () => {
			expect(() => validateReturnUrl(env, 'http://localhost:5173/')).toThrow(IdentityError);
		});

		it('rejects an off-domain URL', () => {
			expect(() => validateReturnUrl(env, 'https://evil.com/x')).toThrow(IdentityError);
		});
	});

	describe('dev mode (COOKIE_DOMAIN=localhost)', () => {
		const env = makeEnv('localhost');

		it('accepts http://localhost with any port', () => {
			expect(validateReturnUrl(env, 'http://localhost:5173/')).toBe('http://localhost:5173/');
			expect(validateReturnUrl(env, 'http://localhost:8080/foo')).toBe('http://localhost:8080/foo');
		});

		it('accepts http://127.0.0.1 with any port', () => {
			expect(validateReturnUrl(env, 'http://127.0.0.1:5173/')).toBe('http://127.0.0.1:5173/');
		});

		it('accepts http://[::1] with any port', () => {
			expect(validateReturnUrl(env, 'http://[::1]:5173/')).toBe('http://[::1]:5173/');
		});

		it('still accepts production .flyindycenter.com URLs', () => {
			expect(validateReturnUrl(env, 'https://app.flyindycenter.com/dashboard')).toBe(
				'https://app.flyindycenter.com/dashboard'
			);
		});

		it('rejects an off-domain URL even in dev', () => {
			expect(() => validateReturnUrl(env, 'https://evil.com/x')).toThrow(IdentityError);
		});

		it('rejects https://localhost (only http loopback allowed)', () => {
			expect(() => validateReturnUrl(env, 'https://localhost:5173/')).toThrow(IdentityError);
		});
	});
});
