// src/oauth/routes.ts
// OAuth 2.0 authorization-server endpoints (RFC 6749) for Indy Center apps.
import { Hono } from 'hono';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import { z } from 'zod';
import { makeDb } from '../db';
import { randomBase32 } from '../crypto';
import { IdentityError } from '../client/errors';
import { buildAuthorizationUrl } from '../auth/oauth';
import { validateSession } from '../sessions/domain';
import { createAuthorizationCode } from '../authorization-codes/domain';
import { buildRedirectWithCode, isAllowedRedirectUri } from './redirect-uri';

export const oauthRoutes = new Hono<{ Bindings: Cloudflare.Env }>();

const OAUTH_STATE_MAX_AGE_SECONDS = 10 * 60;

const AuthorizeQuerySchema = z.object({
	response_type: z.literal('code'),
	client_id: z.string().min(1),
	state: z.string().optional()
});

oauthRoutes.get('/authorize', async (c) => {
	// Validate the redirect target first: every later failure is reported to
	// the browser here, never by redirecting to an unvalidated URI.
	const redirectUri = c.req.query('redirect_uri');
	if (!redirectUri || !isAllowedRedirectUri(redirectUri)) {
		throw new IdentityError(
			'invalid_return_url',
			400,
			'redirect_uri must be on flyindycenter.com or a loopback origin'
		);
	}
	const parsed = AuthorizeQuerySchema.safeParse({
		response_type: c.req.query('response_type'),
		client_id: c.req.query('client_id'),
		state: c.req.query('state')
	});
	if (!parsed.success) {
		throw new IdentityError(
			'validation_failed',
			400,
			'response_type=code and client_id are required'
		);
	}
	const { client_id: clientId, state } = parsed.data;
	const db = makeDb(c.env.DB);

	// SSO: identity already knows this browser. Issue a code without VATSIM.
	const existing = getCookie(c, 'identity_session', 'host');
	if (existing) {
		const session = await validateSession(db, existing);
		if (session) {
			const { code } = await createAuthorizationCode(db, session.userId, redirectUri);
			return c.redirect(buildRedirectWithCode(redirectUri, code, state), 302);
		}
		deleteCookie(c, 'identity_session', { prefix: 'host' });
	}

	const oauthState = randomBase32(16);
	const cookie = {
		prefix: 'host',
		httpOnly: true,
		sameSite: 'Lax',
		maxAge: OAUTH_STATE_MAX_AGE_SECONDS
	} as const;
	setCookie(c, 'oauth_state', oauthState, cookie);
	setCookie(c, 'oauth_return', JSON.stringify({ redirectUri, clientId, state }), cookie);
	return c.redirect(buildAuthorizationUrl(c.env, oauthState).toString(), 302);
});
