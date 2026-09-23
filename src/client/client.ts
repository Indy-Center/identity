// src/client/client.ts
// The consumer side of identity's OAuth endpoints. Uses only fetch and URL,
// so it runs unchanged in Workers, Node and the browser.
import type { SessionContext } from './session-context.js';
import { IdentityError, isErrorCode, type ErrorCode } from './errors.js';
import {
	ErrorWireSchema,
	OAuthErrorWireSchema,
	SessionContextWireSchema,
	TokenResponseWireSchema
} from './wire.js';

export const DEFAULT_IDENTITY_URL = 'https://auth.flyindycenter.com';
export const DEFAULT_CLIENT_ID = 'indy-center-app';

/** Conventional name for an app's own session cookie. */
export const SESSION_COOKIE = 'fic_session';

/**
 * Attributes for the app's session cookie. Accepted as-is by SvelteKit's
 * `cookies.set`, Express's `res.cookie`, and Hono's `setCookie`.
 */
export function sessionCookieOptions({ expiresAt, secure }: { expiresAt: Date; secure: boolean }) {
	return { path: '/', httpOnly: true, sameSite: 'lax' as const, secure, expires: expiresAt };
}

export type ExchangedSession = { token: string; expiresAt: Date; session: SessionContext };

export type CompletedLogin = ExchangedSession & {
	/**
	 * Where to send the browser: the absolute landing URL minus `code`,
	 * `state` and the fragment. Always on the consumer's own origin, since it
	 * is built from the consumer's own request URL.
	 */
	redirectTo: string;
};

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export type IdentityClientOptions = {
	/** Origin for API calls. Default `https://auth.flyindycenter.com`. */
	baseUrl?: string;
	/** fetch implementation. Default `globalThis.fetch`. */
	fetch?: FetchLike;
	/** Origin for browser-facing links (loginUrl, logoutUrl). Default `baseUrl`. */
	publicUrl?: string;
	/** OAuth `client_id`: a label, not a credential. Default `indy-center-app`. */
	clientId?: string;
};

export interface IdentityClient {
	/** identity's /oauth/authorize URL that returns the browser to `redirectUri` with a code. */
	loginUrl(redirectUri: string): string;
	/** identity's global sign-out URL: ends every session the user has, then goes to `returnUrl`. */
	logoutUrl(returnUrl: string): string;
	/**
	 * If `url` carries `?code=`, exchange it and return the session plus the
	 * absolute URL to redirect to (same URL without `code`/`state`). Otherwise null.
	 */
	completeLogin(url: string | URL): Promise<CompletedLogin | null>;
	/** Session context for a token, or null if unknown, expired, or revoked. */
	getSessionContext(token: string): Promise<SessionContext | null>;
	/** Revoke this app's token. No-op for unknown tokens. */
	logout(token: string): Promise<void>;
	/** Exchange an authorization code. Throws IdentityError `invalid_code`. */
	exchangeCode(code: string, redirectUri: string): Promise<ExchangedSession>;
}

// The redirect_uri sent by loginUrl must equal the one completeLogin sends
// with the code, byte for byte (identity compares strings). Both go through
// this: drop our own params and the fragment (browsers never send it to a
// server), and let URLSearchParams re-serialize the query the same way
// identity does when it appends `code`.
function canonicalRedirectUri(raw: string | URL): URL {
	const url = new URL(raw);
	url.searchParams.delete('code');
	url.searchParams.delete('state');
	url.hash = '';
	return url;
}

const OAUTH_ERROR_CODES: Record<string, ErrorCode> = {
	invalid_grant: 'invalid_code',
	invalid_request: 'validation_failed',
	unsupported_grant_type: 'validation_failed',
	invalid_token: 'unauthenticated'
};

async function errorFromResponse(res: Response): Promise<IdentityError> {
	const body: unknown = await res.json().catch(() => null);
	const oauth = OAuthErrorWireSchema.safeParse(body);
	if (oauth.success) {
		const code = OAUTH_ERROR_CODES[oauth.data.error] ?? 'internal';
		return new IdentityError(code, res.status, oauth.data.error_description ?? oauth.data.error);
	}
	const envelope = ErrorWireSchema.safeParse(body);
	if (envelope.success) {
		const { code, message } = envelope.data.error;
		return new IdentityError(isErrorCode(code) ? code : 'internal', res.status, message);
	}
	return new IdentityError('internal', res.status, `identity responded ${res.status}`);
}

// Parse a 2xx body. A body that is not JSON or not the expected shape is
// still an IdentityError, so callers only ever handle one error type.
async function parseBody<T>(res: Response, schema: { parse(v: unknown): T }): Promise<T> {
	try {
		return schema.parse(await res.json());
	} catch {
		throw new IdentityError('internal', res.status, 'unexpected response from identity');
	}
}

export function createIdentityClient(options: IdentityClientOptions = {}): IdentityClient {
	const baseUrl = options.baseUrl ?? DEFAULT_IDENTITY_URL;
	const publicUrl = options.publicUrl ?? baseUrl;
	const clientId = options.clientId ?? DEFAULT_CLIENT_ID;
	const doFetch: FetchLike = options.fetch ?? ((input, init) => fetch(input, init));
	const endpoint = (path: string) => new URL(path, baseUrl).toString();
	const postForm = (path: string, fields: Record<string, string>) =>
		doFetch(endpoint(path), {
			method: 'POST',
			headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
			body: new URLSearchParams(fields).toString()
		});

	async function getSessionContext(token: string): Promise<SessionContext | null> {
		const res = await doFetch(endpoint('/oauth/userinfo'), {
			headers: { Authorization: `Bearer ${token}` }
		});
		if (res.status === 401) {
			return null;
		}
		if (!res.ok) {
			throw await errorFromResponse(res);
		}
		return parseBody(res, SessionContextWireSchema);
	}

	async function exchangeCode(code: string, redirectUri: string): Promise<ExchangedSession> {
		const res = await postForm('/oauth/token', {
			grant_type: 'authorization_code',
			code,
			redirect_uri: redirectUri,
			client_id: clientId
		});
		if (!res.ok) {
			throw await errorFromResponse(res);
		}
		const { access_token, expires_in } = await parseBody(res, TokenResponseWireSchema);
		const session = await getSessionContext(access_token);
		if (!session) {
			throw new IdentityError('internal', 500, 'identity rejected the token it just issued');
		}
		return {
			token: access_token,
			expiresAt: new Date(Date.now() + expires_in * 1000),
			session
		};
	}

	return {
		getSessionContext,
		exchangeCode,

		async logout(token) {
			const res = await postForm('/oauth/revoke', { token });
			if (!res.ok) {
				throw await errorFromResponse(res);
			}
		},

		loginUrl(redirectUri) {
			const url = new URL('/oauth/authorize', publicUrl);
			url.searchParams.set('response_type', 'code');
			url.searchParams.set('client_id', clientId);
			url.searchParams.set('redirect_uri', canonicalRedirectUri(redirectUri).toString());
			return url.toString();
		},

		logoutUrl(returnUrl) {
			const url = new URL('/logout', publicUrl);
			url.searchParams.set('return_url', returnUrl);
			return url.toString();
		},

		async completeLogin(input) {
			const code = new URL(input).searchParams.get('code');
			if (!code) {
				return null;
			}
			const target = canonicalRedirectUri(input);
			const result = await exchangeCode(code, target.toString());
			return { ...result, redirectTo: target.href };
		}
	};
}
