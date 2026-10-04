// Client authentication at /oauth/token (RFC 6749 §2.3.1): client_secret_basic
// or client_secret_post, never both.
export type ClientCredentials = { clientId: string; secret: string };

const BASIC = /^Basic\s+(\S+)$/i;

/**
 * The credentials the request presents, null if it presents none,
 * 'ambiguous' if it uses both methods, or 'malformed' for an undecodable
 * Basic header.
 */
export function parseClientCredentials(
	authorization: string | undefined,
	form: Record<string, string>
): ClientCredentials | null | 'ambiguous' | 'malformed' {
	const basic = authorization?.match(BASIC)?.[1];
	if (basic) {
		if (form.client_secret !== undefined) {
			return 'ambiguous';
		}
		let decoded: string;
		try {
			decoded = atob(basic);
		} catch {
			return 'malformed';
		}
		const colon = decoded.indexOf(':');
		if (colon < 1) {
			return 'malformed';
		}
		try {
			return {
				clientId: decodeURIComponent(decoded.slice(0, colon)),
				secret: decodeURIComponent(decoded.slice(colon + 1))
			};
		} catch {
			return 'malformed';
		}
	}
	if (form.client_id && form.client_secret) {
		return { clientId: form.client_id, secret: form.client_secret };
	}
	return null;
}
