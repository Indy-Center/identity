import { Hono } from 'hono';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import { z } from 'zod';
import { makeDb } from '../db';
import { exchangeCodeForToken } from './oauth';
import { createSession, deleteAllSessionsForUser, findSessionByToken } from '../sessions/domain';
import { upsertFromVatsim } from '../users/domain';
import { fetchVatsimProfile } from './vatsim';
import { IdentityError } from '../errors';
import { createAuthorizationCode } from '../authorization-codes/domain';
import {
	buildRedirectWithCode,
	isAllowedRedirectUri,
	validateReturnUrl
} from '../oauth/redirect-uri';
import { clearLegacySessionCookie } from './legacy-cookie';

// Only /login/callback lives here: it is the redirect URI registered with
// VATSIM Connect. Logins start at GET /oauth/authorize (src/oauth/routes.ts).
export const loginRoutes = new Hono<{ Bindings: Cloudflare.Env }>();

const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 30;

// Bundles every required piece of input on the OAuth callback: the `code`
// and `state` from VATSIM's redirect query, plus the `oauth_state` cookie
// written by /oauth/authorize. The .refine() enforces CSRF protection — the
// state in the query must match the state in the cookie.
const CallbackInputSchema = z
	.object({
		code: z.string().min(1),
		state: z.string().min(1),
		stateCookie: z.string().min(1)
	})
	.refine((d) => d.state === d.stateCookie, { message: 'state cookie mismatch' });

// The authorize request /oauth/authorize stored in __Host-oauth_return.
const ReturnCookieSchema = z.object({
	redirectUri: z.string().refine(isAllowedRedirectUri),
	clientId: z.string().min(1),
	state: z.string().optional()
});

function parseReturnCookie(raw: string | undefined): z.infer<typeof ReturnCookieSchema> | null {
	if (!raw) {
		return null;
	}
	try {
		const parsed = ReturnCookieSchema.safeParse(JSON.parse(raw));
		return parsed.success ? parsed.data : null;
	} catch {
		return null;
	}
}

loginRoutes.get('/callback', async (c) => {
	const parsed = CallbackInputSchema.safeParse({
		code: c.req.query('code'),
		state: c.req.query('state'),
		stateCookie: getCookie(c, 'oauth_state', 'host')
	});
	if (!parsed.success) {
		throw new IdentityError('invalid_state', 400, 'OAuth state cookie missing or mismatched');
	}
	const { code } = parsed.data;
	const authorizeRequest = parseReturnCookie(getCookie(c, 'oauth_return', 'host'));
	if (!authorizeRequest) {
		throw new IdentityError(
			'invalid_state',
			400,
			'oauth_return cookie missing or malformed — start the login at /oauth/authorize'
		);
	}

	let accessToken: string;
	try {
		accessToken = await exchangeCodeForToken(c.env, code);
	} catch (err) {
		console.error('OAuth exchange failed', err);
		throw new IdentityError('oauth_exchange_failed', 502, 'failed to exchange authorization code');
	}

	const profile = await fetchVatsimProfile(c.env.CONNECT_BASE_URL, accessToken);
	const db = makeDb(c.env.DB);
	const user = await upsertFromVatsim(db, profile);
	if (!user.isActive) {
		throw new IdentityError('access_denied', 403, 'account disabled');
	}

	// Mint the code before writing any cookies: if D1 fails here, the browser
	// is left with no half-applied session or state cookies.
	const { redirectUri, state } = authorizeRequest;
	const { code: authorizationCode } = await createAuthorizationCode(db, user.id, redirectUri);

	// identity's own session: lets /oauth/authorize skip VATSIM next time.
	const { token } = await createSession(db, user.id);
	setCookie(c, 'identity_session', token, {
		prefix: 'host',
		httpOnly: true,
		sameSite: 'Lax',
		maxAge: SESSION_MAX_AGE_SECONDS
	});
	deleteCookie(c, 'oauth_state', { prefix: 'host' });
	deleteCookie(c, 'oauth_return', { prefix: 'host' });
	clearLegacySessionCookie(c);

	return c.redirect(buildRedirectWithCode(redirectUri, authorizationCode, state), 302);
});

export const logoutRoutes = new Hono<{ Bindings: Cloudflare.Env }>();

// Global sign-out: ends every session the user has (identity's and every
// app's), then returns the browser to return_url.
logoutRoutes.get('/', async (c) => {
	const returnUrl = validateReturnUrl(c.req.query('return_url'));

	const token = getCookie(c, 'identity_session', 'host');
	if (token) {
		const db = makeDb(c.env.DB);
		const session = await findSessionByToken(db, token);
		if (session) {
			await deleteAllSessionsForUser(db, session.userId);
		}
	}

	deleteCookie(c, 'identity_session', { prefix: 'host' });
	clearLegacySessionCookie(c);

	return c.redirect(returnUrl, 302);
});
