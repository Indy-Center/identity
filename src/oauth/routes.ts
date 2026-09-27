// src/oauth/routes.ts
// OAuth 2.0 authorization-server endpoints (RFC 6749) for Indy Center apps.
import { Hono, type Context } from 'hono';
import { cors } from 'hono/cors';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import { z } from 'zod';
import { makeDb } from '../db';
import { randomBase32 } from '../crypto';
import { IdentityError } from '../errors';
import { buildAuthorizationUrl } from '../auth/oauth';
import { validateSession } from '../sessions/domain';
import { createAuthorizationCode, exchangeAuthorizationCode } from '../authorization-codes/domain';
import { getSessionContext, logout } from '../sessions/context';
import { serializeUserinfo } from '../sessions/context';
import { buildRedirectWithCode, isAllowedOrigin, isAllowedRedirectUri } from './redirect-uri';
import { clearLegacySessionCookie } from '../auth/legacy-cookie';

type Env = { Bindings: Cloudflare.Env };

export const oauthRoutes = new Hono<Env>();

// Browser-only apps call /oauth/* directly with a bearer token. Reflect only
// allowlisted origins; no credentials, since nothing here reads a cookie
// cross-origin.
oauthRoutes.use(
	'*',
	cors({
		origin: (origin) => (isAllowedOrigin(origin) ? origin : null),
		allowMethods: ['GET', 'POST', 'OPTIONS'],
		allowHeaders: ['Authorization', 'Content-Type']
	})
);

// RFC 6749 §5.2 error body.
function oauthError(c: Context<Env>, error: string, description: string) {
	c.header('Cache-Control', 'no-store');
	return c.json({ error, error_description: description }, 400);
}

// Bearer-only: cookies (identity's own or any legacy one) are never accepted
// here, so a value sitting only in a cookie is treated as no token at all.
const BEARER_PATTERN = /^Bearer\s+(\S+)$/i;

function bearerToken(c: Context<Env>): string {
	const header = c.req.header('Authorization') ?? '';
	return header.match(BEARER_PATTERN)?.[1] ?? '';
}

const OAUTH_STATE_MAX_AGE_SECONDS = 10 * 60;
const REDIRECT_URI_MAX_LENGTH = 2048;

const AuthorizeQuerySchema = z.object({
	response_type: z.literal('code'),
	client_id: z.string().min(1).max(2048),
	state: z.string().max(1024).optional()
});

oauthRoutes.get('/authorize', async (c) => {
	// Validate the redirect target first: every later failure is reported to
	// the browser here, never by redirecting to an unvalidated URI.
	const redirectUri = c.req.query('redirect_uri');
	if (
		!redirectUri ||
		redirectUri.length > REDIRECT_URI_MAX_LENGTH ||
		!isAllowedRedirectUri(redirectUri)
	) {
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
			clearLegacySessionCookie(c);
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

// Hono's own c.req.parseBody() re-checks Content-Type against the raw header
// case-sensitively, so it silently returns {} for a body whose Content-Type
// we've already accepted case-insensitively below. Parse the form ourselves
// instead of relying on it.
function isFormContentType(c: Context<Env>): boolean {
	const contentType = (c.req.header('Content-Type') ?? '').toLowerCase();
	return contentType.startsWith('application/x-www-form-urlencoded');
}

async function parseFormBody(c: Context<Env>): Promise<Record<string, string>> {
	const form = await c.req.formData();
	return Object.fromEntries([...form.entries()].map(([k, v]) => [k, String(v)]));
}

const TokenRequestSchema = z.object({
	grant_type: z.string().min(1),
	code: z.string().min(1).max(2048),
	redirect_uri: z.string().min(1).max(2048),
	client_id: z.string().min(1).max(2048)
});

oauthRoutes.post('/token', async (c) => {
	if (!isFormContentType(c)) {
		return oauthError(c, 'invalid_request', 'body must be application/x-www-form-urlencoded');
	}
	const parsed = TokenRequestSchema.safeParse(await parseFormBody(c));
	if (!parsed.success) {
		return oauthError(
			c,
			'invalid_request',
			'grant_type, code, redirect_uri and client_id are required'
		);
	}
	const { grant_type, code, redirect_uri } = parsed.data;
	if (grant_type !== 'authorization_code') {
		return oauthError(c, 'unsupported_grant_type', 'only authorization_code is supported');
	}
	const minted = await exchangeAuthorizationCode(makeDb(c.env.DB), code, redirect_uri);
	if (!minted) {
		return oauthError(
			c,
			'invalid_grant',
			'authorization code is invalid, expired, or was issued for a different redirect_uri'
		);
	}
	c.header('Cache-Control', 'no-store');
	c.header('Pragma', 'no-cache');
	return c.json({
		access_token: minted.token,
		token_type: 'Bearer',
		expires_in: Math.floor((minted.expiresAt - Date.now()) / 1000)
	});
});

oauthRoutes.get('/userinfo', async (c) => {
	const token = bearerToken(c);
	const ctx = token ? await getSessionContext(c.env, token) : null;
	if (!ctx) {
		c.header('WWW-Authenticate', 'Bearer error="invalid_token"');
		return c.json({ error: 'invalid_token' }, 401);
	}
	c.header('Cache-Control', 'no-store');
	return c.json(serializeUserinfo(ctx));
});

const RevokeRequestSchema = z.object({ token: z.string().max(2048).optional() });

// RFC 7009: always 200, even for an unknown or invalid token — malformed
// requests (wrong content type) are the one thing §2.2.1 lets us reject.
oauthRoutes.post('/revoke', async (c) => {
	if (!isFormContentType(c)) {
		return oauthError(c, 'invalid_request', 'body must be application/x-www-form-urlencoded');
	}
	const parsed = RevokeRequestSchema.safeParse(await parseFormBody(c));
	if (!parsed.success) {
		return oauthError(c, 'invalid_request', 'token must be a string');
	}
	if (parsed.data.token) {
		await logout(c.env, parsed.data.token);
	}
	return c.body(null, 200);
});
