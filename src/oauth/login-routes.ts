import { Hono } from 'hono';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import { z } from 'zod';
import { makeDb } from '../db';
import { exchangeCodeForToken, fetchVatsimProfile } from './vatsim';
import {
	createSession,
	deleteAllSessionsForUser,
	findSessionByToken,
	validateSession
} from '../sessions/domain';
import { getUser, upsertFromVatsim } from '../users/domain';
import { listRoles } from '../users/roles';
import { toClaims } from '../users/claims';
import { IdentityError } from '../errors';
import { logEvent } from '../log';
import { createAuthorizationCode } from './codes';
import { buildRedirectWithCode, redirectAllowedFor, validateReturnUrl } from './redirect-uri';
import { clearLegacySessionCookie } from './legacy-cookie';

// Only /login/callback lives here: it is the redirect URI registered with
// VATSIM Connect. Logins start at GET /oauth/authorize (src/oauth/routes.ts).
export const loginRoutes = new Hono<{ Bindings: Cloudflare.Env }>();

const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 30;

// The authorize request /oauth/authorize stored in __Host-oauth_return. Its
// redirectUri is re-checked against the client in the handler.
const ReturnCookieSchema = z.object({
	redirectUri: z.string().min(1),
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
	const code = c.req.query('code');
	const vatsimState = c.req.query('state');
	// CSRF: the state VATSIM echoes back must match the cookie /oauth/authorize set.
	if (!code || !vatsimState || vatsimState !== getCookie(c, 'oauth_state', 'host')) {
		throw new IdentityError('invalid_state', 400, 'OAuth state cookie missing or mismatched');
	}
	const db = makeDb(c.env.DB);
	const authorizeRequest = parseReturnCookie(getCookie(c, 'oauth_return', 'host'));
	// Re-check the redirect now, not just at /oauth/authorize: the cookie is
	// only as trustworthy as the browser, and the client's redirect_uris may
	// have changed mid-login.
	if (
		!authorizeRequest ||
		!(await redirectAllowedFor(db, authorizeRequest.clientId, authorizeRequest.redirectUri))
	) {
		throw new IdentityError(
			'invalid_state',
			400,
			'oauth_return cookie missing, malformed, or not allowed for its client — start the login at /oauth/authorize'
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
	const user = await upsertFromVatsim(db, profile);
	if (!user.active) {
		logEvent('login_denied', { cid: user.cid, reason: 'disabled' });
		throw new IdentityError('access_denied', 403, 'account disabled');
	}

	// Mint the code before writing any cookies: if D1 fails here, the browser
	// is left with no half-applied session or state cookies.
	const { redirectUri, clientId, state } = authorizeRequest;
	logEvent('login', { cid: user.cid, client_id: clientId, via: 'vatsim' });
	const { code: authorizationCode } = await createAuthorizationCode(
		db,
		user.cid,
		redirectUri,
		clientId
	);

	// identity's own session: lets /oauth/authorize skip VATSIM next time.
	const { token } = await createSession(db, user.cid);
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
			await deleteAllSessionsForUser(db, session.cid);
			logEvent('logout', { cid: session.cid });
		}
	}

	deleteCookie(c, 'identity_session', { prefix: 'host' });
	clearLegacySessionCookie(c);

	return c.redirect(returnUrl, 302);
});

export const meRoutes = new Hono<{ Bindings: Cloudflare.Env }>();

// The signed-in browser's own record, read from identity's cookie. This is the
// only route that takes the cookie as authentication, and it only reads:
// /oauth/userinfo and /api stay bearer-only, so no other site can act through
// a visitor's browser.
meRoutes.get('/', async (c) => {
	c.header('Cache-Control', 'no-store');
	const token = getCookie(c, 'identity_session', 'host');
	const db = makeDb(c.env.DB);
	const session = token ? await validateSession(db, token) : null;
	const user = session ? await getUser(db, session.cid) : null;
	if (!user) {
		throw new IdentityError(
			'unauthenticated',
			401,
			'not signed in: log in through an Indy Center app first'
		);
	}
	return c.json({ ...toClaims(user, await listRoles(db, user.cid)), email: user.email });
});
