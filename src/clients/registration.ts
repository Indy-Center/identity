// The rules for registering a client, shared by /api/clients and
// scripts/manage-sql.ts. The script runs under Node, so relative imports here
// carry their .ts extension.
import { randomBase32 } from '../crypto.ts';
import { LOOPBACK, REDIRECT_URI_MAX_LENGTH } from '../oauth/redirect-uri-rules.ts';

const CLIENT_ID = /^[a-z0-9-]+$/;
// `cli` is the role source for grants made by `npm run role`; a client with
// that id could otherwise remove global:* rows through the API.
const RESERVED_CLIENT_IDS = new Set(['cli']);

/** Why `id` cannot be a client id, or null if it can. */
export function clientIdProblem(id: string): string | null {
	if (!CLIENT_ID.test(id)) {
		return 'use lowercase letters, digits and dashes';
	}
	return RESERVED_CLIENT_IDS.has(id) ? 'reserved' : null;
}

/**
 * Why a registered client may not use `uri` as a redirect URI, or null if it
 * may: an absolute https URL (or http on loopback, as for the allowlist), no
 * userinfo, no fragment (RFC 6749 §3.1.2), no whitespace or control
 * characters, at most REDIRECT_URI_MAX_LENGTH long.
 */
export function redirectUriProblem(uri: string): string | null {
	if (uri.length > REDIRECT_URI_MAX_LENGTH) {
		return `longer than ${REDIRECT_URI_MAX_LENGTH} characters`;
	}
	if (/[\s\p{Cc}]/u.test(uri)) {
		return 'contains whitespace or control characters';
	}
	if (uri.includes('#')) {
		return 'must not contain a fragment';
	}
	let url: URL;
	try {
		url = new URL(uri);
	} catch {
		return 'not an absolute URL';
	}
	if (url.username || url.password) {
		return 'must not contain credentials';
	}
	const https = url.protocol === 'https:' && uri.startsWith('https://') && url.hostname !== '';
	if (!https && !LOOPBACK.test(uri)) {
		return 'must be https (http only on localhost, 127.0.0.1 or [::1])';
	}
	return null;
}

/** `<id>_<52 base32 chars>`: 32 random bytes, prefixed for readability. */
export function newClientSecret(id: string): string {
	return `${id}_${randomBase32(32)}`;
}
