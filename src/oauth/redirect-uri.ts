import type { DB } from '../db';
import { IdentityError } from '../errors';
import { findClient } from '../clients/domain';
import { LOOPBACK, REDIRECT_URI_MAX_LENGTH } from './redirect-uri-rules';

// Where identity may send a browser: https on flyindycenter.com or one level
// of subdomain, or http on a loopback host at any port. PRODUCTION has the
// same tail as LOOPBACK (explained in redirect-uri-rules.ts), so a bare origin
// matches too; that is what lets CORS reuse these rules.
const PRODUCTION = /^https:\/\/([a-z0-9-]+\.)?flyindycenter\.com(\/[^\s]*)?$/;

export function isAllowedRedirectUri(url: string): boolean {
	return PRODUCTION.test(url) || LOOPBACK.test(url);
}

/**
 * Whether identity may send `clientId`'s authorization code to `uri`. A
 * registered client gets exact matching against its own redirect_uris (a
 * service with none cannot use the code flow); an unregistered client_id is a
 * first-party label trusted by the allowlist.
 */
export async function redirectAllowedFor(db: DB, clientId: string, uri: string): Promise<boolean> {
	if (uri.length > REDIRECT_URI_MAX_LENGTH) {
		return false;
	}
	const client = await findClient(db, clientId);
	return client ? (client.redirectUris ?? []).includes(uri) : isAllowedRedirectUri(uri);
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

/** The URL identity redirects to after login: `redirectUri` plus `code` (and `state`). */
export function buildRedirectWithCode(redirectUri: string, code: string, state?: string): string {
	const url = new URL(redirectUri);
	url.searchParams.set('code', code);
	if (state !== undefined) {
		url.searchParams.set('state', state);
	}
	return url.toString();
}
