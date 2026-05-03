import { Hono } from 'hono';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import { z } from 'zod';
import { makeDb } from '../db';
import { buildAuthorizationUrl, exchangeCodeForToken } from './oauth';
import { createSession } from '../sessions/domain';
import { upsertFromVatsim } from '../users/domain';
import { fetchVatsimProfile } from './vatsim';
import { randomBase32 } from '../crypto';
import { IdentityError } from '../client/errors';

export const loginRoutes = new Hono<{ Bindings: Cloudflare.Env }>();

const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 30;
const OAUTH_STATE_MAX_AGE_SECONDS = 10 * 60;

const ProductionReturnUrlSchema = z
	.string()
	.regex(/^https:\/\/([a-z0-9-]+\.)?flyindycenter\.com(\/|$)/);
const LoopbackReturnUrlSchema = z
	.string()
	.regex(/^http:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?(\/|$)/);

export function validateReturnUrl(env: Cloudflare.Env, raw: string | undefined): string | null {
	if (!raw) return null;
	if (ProductionReturnUrlSchema.safeParse(raw).success) return raw;
	if (env.COOKIE_DOMAIN === 'localhost' && LoopbackReturnUrlSchema.safeParse(raw).success)
		return raw;
	throw new IdentityError('invalid_return_url', 400, 'return_url must be on flyindycenter.com');
}

// Bundles every required piece of input on the OAuth callback: the `code`
// and `state` from VATSIM's redirect query, plus the `oauth_state` cookie
// we wrote during /login. The .refine() enforces CSRF protection — the
// state in the query must match the state in the cookie.
const CallbackInputSchema = z
	.object({
		code: z.string().min(1),
		state: z.string().min(1),
		stateCookie: z.string().min(1)
	})
	.refine((d) => d.state === d.stateCookie, { message: 'state cookie mismatch' });

loginRoutes.get('/', (c) => {
	const returnUrl = validateReturnUrl(c.env, c.req.query('return_url'));
	if (!returnUrl) {
		throw new IdentityError('invalid_return_url', 400, 'return_url query parameter is required');
	}
	const state = randomBase32(16);
	const authorizeUrl = buildAuthorizationUrl(c.env, state);

	setCookie(c, 'oauth_state', state, {
		prefix: 'host',
		httpOnly: true,
		sameSite: 'Lax',
		maxAge: OAUTH_STATE_MAX_AGE_SECONDS
	});
	setCookie(c, 'oauth_return', returnUrl, {
		prefix: 'host',
		httpOnly: true,
		sameSite: 'Lax',
		maxAge: OAUTH_STATE_MAX_AGE_SECONDS
	});
	return c.redirect(authorizeUrl.toString(), 302);
});

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
	const returnCookie = getCookie(c, 'oauth_return', 'host');
	if (!returnCookie) {
		throw new IdentityError(
			'invalid_state',
			400,
			'oauth_return cookie missing — login flow must include return_url'
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
	const { token } = await createSession(db, user.id);

	setCookie(c, 'fic_session', token, {
		domain: c.env.COOKIE_DOMAIN === 'localhost' ? undefined : c.env.COOKIE_DOMAIN,
		path: '/',
		httpOnly: true,
		secure: c.env.COOKIE_SECURE === 'true',
		sameSite: 'Lax',
		maxAge: SESSION_MAX_AGE_SECONDS
	});
	deleteCookie(c, 'oauth_state', { prefix: 'host' });
	deleteCookie(c, 'oauth_return', { prefix: 'host' });

	return c.redirect(returnCookie, 302);
});
