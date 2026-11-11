// OAuth 2.0 authorization-server endpoints (RFC 6749) for Indy Center apps.
import { Hono, type Context } from 'hono';
import { cors } from 'hono/cors';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import { describeRoute } from 'hono-openapi';
import { z } from 'zod';
import { makeDb } from '../db';
import { randomBase32 } from '../crypto';
import { IdentityError } from '../errors';
import { logEvent } from '../log';
import { buildAuthorizationUrl } from './vatsim';
import { deleteSessionByToken, validateSession } from '../sessions/domain';
import { getUser } from '../users/domain';
import { createAuthorizationCode, exchangeAuthorizationCode } from './codes';
import { userinfo } from './userinfo';
import { buildRedirectWithCode, isAllowedRedirectUri, redirectAllowedFor } from './redirect-uri';
import { clearLegacySessionCookie } from './legacy-cookie';
import {
	authenticateClient,
	findClient,
	grantScopes,
	issueClientToken,
	revokeClientToken
} from '../clients/domain';
import { parseClientCredentials } from '../clients/credentials';
import { bearerToken } from '../api/principal';

type Env = { Bindings: Cloudflare.Env };

export const oauthRoutes = new Hono<Env>();

// Browser-only apps call /oauth/* directly with a bearer token. Reflect only
// allowlisted origins (the same rules as redirect URIs, which match a bare
// origin too); no credentials, since nothing here reads a cookie cross-origin.
oauthRoutes.use(
	'*',
	cors({
		origin: (origin) => (isAllowedRedirectUri(origin) ? origin : null),
		allowMethods: ['GET', 'POST', 'OPTIONS'],
		allowHeaders: ['Authorization', 'Content-Type']
	})
);

// RFC 6749 §5.2 error body.
function oauthError(c: Context<Env>, error: string, description: string, status: 400 | 401 = 400) {
	c.header('Cache-Control', 'no-store');
	return c.json({ error, error_description: description }, status);
}

// RFC 6749 §5.2: failed client authentication is a 401 with a challenge.
function invalidClient(c: Context<Env>) {
	logEvent('client_auth_failed');
	c.header('WWW-Authenticate', 'Basic realm="identity"');
	return oauthError(c, 'invalid_client', 'client authentication failed', 401);
}

const OAUTH_STATE_MAX_AGE_SECONDS = 10 * 60;

const AuthorizeQuerySchema = z.object({
	response_type: z.literal('code'),
	client_id: z.string().min(1).max(2048),
	state: z.string().max(1024).optional()
});

const oauthTags = ['OAuth 2.0'];

oauthRoutes.get(
	'/authorize',
	describeRoute({
		tags: oauthTags,
		summary: 'Start the authorization-code flow (RFC 6749 §4.1)',
		description:
			'Browser redirect. Registered clients must use an exactly registered redirect_uri; unregistered client_ids must redirect to https *.flyindycenter.com or http loopback. Returns 302 to the redirect_uri with ?code=&state=.',
		responses: { 302: { description: 'Redirect to VATSIM, or back to redirect_uri with a code' } }
	}),
	async (c) => {
		// Every failure here is a 400 to the browser, never a redirect to an
		// unvalidated URI.
		const parsed = AuthorizeQuerySchema.safeParse(c.req.query());
		if (!parsed.success) {
			throw new IdentityError(
				'validation_failed',
				400,
				'response_type=code and client_id are required'
			);
		}
		const db = makeDb(c.env.DB);
		const redirectUri = c.req.query('redirect_uri');
		if (!redirectUri || !(await redirectAllowedFor(db, parsed.data.client_id, redirectUri))) {
			throw new IdentityError(
				'invalid_return_url',
				400,
				'redirect_uri is not registered for this client, or not on flyindycenter.com or a loopback origin'
			);
		}
		const { client_id: clientId, state } = parsed.data;

		// SSO: identity already knows this browser. Issue a code without VATSIM.
		const existing = getCookie(c, 'identity_session', 'host');
		if (existing) {
			const session = await validateSession(db, existing);
			if (session) {
				const code = await createAuthorizationCode(db, session.cid, redirectUri, clientId);
				logEvent('login', { cid: session.cid, client_id: clientId, via: 'sso' });
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
	}
);

function isFormContentType(c: Context<Env>): boolean {
	const contentType = (c.req.header('Content-Type') ?? '').toLowerCase();
	return contentType.startsWith('application/x-www-form-urlencoded');
}

// Hono's own c.req.parseBody() re-checks Content-Type against the raw header
// case-sensitively, so it silently returns {} for a body whose Content-Type
// isFormContentType accepted case-insensitively. Parse the form ourselves.
async function parseFormBody(c: Context<Env>): Promise<Record<string, string>> {
	const form = await c.req.formData();
	return Object.fromEntries([...form.entries()].map(([k, v]) => [k, String(v)]));
}

const AuthorizationCodeSchema = z.object({
	code: z.string().min(1).max(2048),
	redirect_uri: z.string().min(1).max(2048),
	client_id: z.string().min(1).max(2048).optional()
});

oauthRoutes.post(
	'/token',
	describeRoute({
		tags: oauthTags,
		summary: 'Exchange a code, or get a client-credentials token (RFC 6749 §4.1.3, §4.4)',
		description:
			'application/x-www-form-urlencoded. grant_type=authorization_code (code, redirect_uri, client_id) or grant_type=client_credentials (optional scope). Registered clients authenticate with client_secret_basic or client_secret_post (§2.3.1). Errors per §5.2.',
		responses: {
			200: { description: '{ access_token, token_type: "Bearer", expires_in, scope? }' },
			400: {
				description: 'invalid_request | invalid_grant | invalid_scope | unsupported_grant_type'
			},
			401: { description: 'invalid_client' }
		}
	}),
	async (c) => {
		if (!isFormContentType(c)) {
			return oauthError(c, 'invalid_request', 'body must be application/x-www-form-urlencoded');
		}
		let form: Record<string, string>;
		try {
			form = await parseFormBody(c);
		} catch {
			return oauthError(c, 'invalid_request', 'body could not be parsed');
		}
		const credentials = parseClientCredentials(c.req.header('Authorization'), form);
		// Both methods at once is a malformed request (§2.3); an undecodable
		// Basic header is failed client authentication (§5.2).
		if (credentials === 'ambiguous') {
			return oauthError(c, 'invalid_request', 'use exactly one client authentication method');
		}
		if (credentials === 'malformed') {
			return invalidClient(c);
		}
		const db = makeDb(c.env.DB);
		c.header('Cache-Control', 'no-store');
		c.header('Pragma', 'no-cache');

		if (!form.grant_type) {
			return oauthError(c, 'invalid_request', 'grant_type is required');
		}

		if (form.grant_type === 'client_credentials') {
			const client =
				credentials && (await authenticateClient(db, credentials.clientId, credentials.secret));
			if (!client) {
				return invalidClient(c);
			}
			// An empty grant (a client registered with no scopes) is refused rather
			// than minting a token that can do nothing.
			const scopes = grantScopes(client.scopes, form.scope);
			if (!scopes || scopes.length === 0) {
				return oauthError(c, 'invalid_scope', 'requested scope exceeds what this client may have');
			}
			const issued = await issueClientToken(db, client.id, scopes);
			logEvent('token_issued', { grant: 'client_credentials', client_id: client.id, scopes });
			return c.json({
				access_token: issued.token,
				token_type: 'Bearer',
				expires_in: issued.expiresIn,
				scope: issued.scopes.join(' ')
			});
		}

		if (form.grant_type !== 'authorization_code') {
			return oauthError(
				c,
				'unsupported_grant_type',
				'grant_type must be authorization_code or client_credentials'
			);
		}
		const parsed = AuthorizationCodeSchema.safeParse(form);
		const clientId = credentials?.clientId ?? parsed.data?.client_id;
		if (!parsed.success || !clientId) {
			return oauthError(c, 'invalid_request', 'code, redirect_uri and client_id are required');
		}
		if (credentials && parsed.data.client_id && parsed.data.client_id !== credentials.clientId) {
			return oauthError(c, 'invalid_request', 'client_id does not match the authenticated client');
		}
		// Registered clients must authenticate; an unregistered client_id is a
		// first-party public client and must not present a secret.
		const authenticated = credentials
			? await authenticateClient(db, clientId, credentials.secret)
			: !(await findClient(db, clientId));
		if (!authenticated) {
			return invalidClient(c);
		}
		const minted = await exchangeAuthorizationCode(
			db,
			parsed.data.code,
			parsed.data.redirect_uri,
			clientId
		);
		if (!minted) {
			return oauthError(
				c,
				'invalid_grant',
				'authorization code is invalid, expired, or was issued for a different redirect_uri or client'
			);
		}
		logEvent('token_issued', { grant: 'authorization_code', client_id: clientId, cid: minted.cid });
		return c.json({
			access_token: minted.token,
			token_type: 'Bearer',
			expires_in: Math.floor((minted.expiresAt - Date.now()) / 1000)
		});
	}
);

oauthRoutes.get(
	'/userinfo',
	describeRoute({
		tags: oauthTags,
		summary: "The user's claims (OIDC Core §5.1 names where standard)",
		security: [{ bearerAuth: [] }],
		responses: {
			200: { description: 'Claims plus email, active_session, active_flight_plan' },
			401: { description: 'invalid_token' }
		}
	}),
	async (c) => {
		const token = bearerToken(c.req.header('Authorization'));
		const db = makeDb(c.env.DB);
		const session = token ? await validateSession(db, token) : null;
		const user = session ? await getUser(db, session.cid) : null;
		c.header('Cache-Control', 'no-store');
		if (!user) {
			c.header('WWW-Authenticate', 'Bearer error="invalid_token"');
			return c.json({ error: 'invalid_token' }, 401);
		}
		return c.json(await userinfo(db, user));
	}
);

const RevokeRequestSchema = z.object({ token: z.string().max(2048).optional() });

// RFC 7009: always 200, even for an unknown or invalid token — malformed
// requests (wrong content type) are the one thing §2.2.1 lets us reject.
oauthRoutes.post(
	'/revoke',
	describeRoute({
		tags: oauthTags,
		summary: 'Revoke a user or client token (RFC 7009)',
		responses: { 200: { description: 'Always, even for unknown tokens' } }
	}),
	async (c) => {
		if (!isFormContentType(c)) {
			return oauthError(c, 'invalid_request', 'body must be application/x-www-form-urlencoded');
		}
		const parsed = RevokeRequestSchema.safeParse(await parseFormBody(c));
		if (!parsed.success) {
			return oauthError(c, 'invalid_request', 'token must be a string');
		}
		if (parsed.data.token) {
			const db = makeDb(c.env.DB);
			await Promise.all([
				deleteSessionByToken(db, parsed.data.token),
				revokeClientToken(db, parsed.data.token)
			]);
		}
		return c.body(null, 200);
	}
);
