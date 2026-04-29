import { Hono } from 'hono';
import type { Env, AppVariables } from '../env';
import { buildAuthorizationUrl } from '../domain/oauth';
import { buildHostStateSetCookie } from '../domain/cookies';
import { randomBase32 } from '../lib/crypto';
import { AppError } from '../lib/errors';

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
