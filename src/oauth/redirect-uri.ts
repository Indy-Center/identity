// src/oauth/redirect-uri.ts
import { IdentityError } from '../client/errors';

// Where identity may send a browser: https on flyindycenter.com or one level
// of subdomain, or http on a loopback host (RFC 8252 §7.3) at any port. Both
// patterns end in (\/|$), so a bare origin (scheme://host[:port]) matches the
// same rules as a full URL; that is what lets CORS reuse them.
const PRODUCTION = /^https:\/\/([a-z0-9-]+\.)?flyindycenter\.com(\/|$)/;
const LOOPBACK = /^http:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?(\/|$)/;

export function isAllowedRedirectUri(url: string): boolean {
	return PRODUCTION.test(url) || LOOPBACK.test(url);
}

/** CORS origin allowlist. Same rules as redirect URIs. */
export function isAllowedOrigin(origin: string): boolean {
	return isAllowedRedirectUri(origin);
}

/** For GET /logout: the return_url must be present and allowed. */
export function validateReturnUrl(raw: string | undefined): string {
	if (!raw) {
		throw new IdentityError('invalid_return_url', 400, 'return_url query parameter is required');
	}
	if (!isAllowedRedirectUri(raw)) {
		throw new IdentityError(
			'invalid_return_url',
			400,
			'return_url must be on flyindycenter.com or a loopback origin'
		);
	}
	return raw;
}
