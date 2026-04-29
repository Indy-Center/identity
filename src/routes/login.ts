import { Hono } from 'hono';
import { getCookie } from 'hono/cookie';
import type { Env, AppVariables } from '../env';
import { buildAuthorizationUrl, exchangeCodeForToken } from '../domain/oauth';
import {
	buildHostStateSetCookie,
	buildHostStateClearCookie,
	buildSessionSetCookie
} from '../domain/cookies';
import { randomBase32 } from '../lib/crypto';
import { AppError } from '../lib/errors';
import { fetchVatsimProfile } from '../domain/vatsim';
import { upsertFromVatsim } from '../domain/users';
import { createSession } from '../domain/session';
import { makeDb } from '../db/client';
import { systemClock } from '../lib/time';

export const loginRoutes = new Hono<{ Bindings: Env; Variables: AppVariables }>();

const RETURN_URL_PATTERN = /^https:\/\/[a-z0-9-]+\.flyindycenter\.com(\/|$)/;

function validateReturnUrl(raw: string | undefined): string | null {
	if (!raw) return null;
	if (!RETURN_URL_PATTERN.test(raw)) {
		throw new AppError('invalid_return_url', 400, 'return_url must be on .flyindycenter.com');
	}
	return raw;
}

loginRoutes.get('/', (c) => {
	const returnUrl = validateReturnUrl(c.req.query('return_url'));
	const state = randomBase32(16);
	const authorizeUrl = buildAuthorizationUrl(c.env, state);

	c.header('Set-Cookie', buildHostStateSetCookie('oauth_state', state), { append: true });
	if (returnUrl) {
		c.header('Set-Cookie', buildHostStateSetCookie('oauth_return', returnUrl), { append: true });
	}
	return c.redirect(authorizeUrl.toString(), 302);
});

const DEFAULT_RETURN_URL = 'https://flyindycenter.com';

loginRoutes.get('/callback', async (c) => {
	const code = c.req.query('code');
	const state = c.req.query('state');
	const stateCookie = getCookie(c, '__Host-oauth_state');
	const returnCookie = getCookie(c, '__Host-oauth_return');

	if (!code || !state || !stateCookie || stateCookie !== state) {
		throw new AppError('invalid_state', 400, 'OAuth state cookie missing or mismatched');
	}

	let accessToken: string;
	try {
		accessToken = await exchangeCodeForToken(c.env, code);
	} catch (err) {
		console.error('OAuth exchange failed', err);
		throw new AppError('oauth_exchange_failed', 502, 'failed to exchange authorization code');
	}

	const profile = await fetchVatsimProfile(c.env.CONNECT_BASE_URL, accessToken);
	const db = makeDb(c.env.DB);
	const userId = await upsertFromVatsim(db, profile, systemClock);
	const { token } = await createSession(db, userId, systemClock);

	c.header('Set-Cookie', buildSessionSetCookie(token, c.env.COOKIE_DOMAIN), { append: true });
	c.header('Set-Cookie', buildHostStateClearCookie('oauth_state'), { append: true });
	c.header('Set-Cookie', buildHostStateClearCookie('oauth_return'), { append: true });

	const dest = returnCookie ?? DEFAULT_RETURN_URL;
	return c.redirect(dest, 302);
});
