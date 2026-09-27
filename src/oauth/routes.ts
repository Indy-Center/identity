// src/oauth/routes.ts
// OAuth 2.0 authorization-server endpoints (RFC 6749) for Indy Center apps.
import { Hono, type Context } from 'hono';
import { cors } from 'hono/cors';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import { z } from 'zod';
import { makeDb } from '../db';
import { randomBase32 } from '../crypto';
import { IdentityError } from '../errors';
import { buildAuthorizationUrl } from './vatsim';
import { deleteSessionByToken, validateSession } from '../sessions/domain';
import { getUser } from '../users/domain';
import { listRoles } from '../users/roles';
import { toClaims } from '../users/claims';
import { getActiveSession } from '../incubator/presence/domain';
import { getFlightPlan } from '../incubator/flight-plans/domain';
import { createAuthorizationCode, exchangeAuthorizationCode } from './codes';
import { buildRedirectWithCode, isAllowedOrigin, isAllowedRedirectUri } from './redirect-uri';
import { clearLegacySessionCookie } from './legacy-cookie';
import {
	authenticateClient,
	findClient,
	grantScopes,
	issueClientToken,
	revokeClientToken
} from '../clients/domain';
import { parseClientCredentials } from '../clients/credentials';

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

// RFC 6749 §5.2: failed client authentication is a 401 with a challenge.
function invalidClient(c: Context<Env>) {
	c.header('Cache-Control', 'no-store');
	c.header('WWW-Authenticate', 'Basic realm="identity"');
	return c.json(
		{ error: 'invalid_client', error_description: 'client authentication failed' },
		401
	);
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
	const db = makeDb(c.env.DB);
	const requestedClientId = c.req.query('client_id');
	const client = requestedClientId ? await findClient(db, requestedClientId) : null;
	// A registered client gets exact matching against its own list (and a
	// service with no redirect_uris cannot use this flow); an unregistered
	// client_id is a first-party label trusted by the allowlist.
	const allowed =
		!!redirectUri &&
		redirectUri.length <= REDIRECT_URI_MAX_LENGTH &&
		(client
			? (client.redirectUris ?? []).includes(redirectUri)
			: isAllowedRedirectUri(redirectUri));
	if (!allowed) {
		throw new IdentityError(
			'invalid_return_url',
			400,
			'redirect_uri is not registered for this client, or not on flyindycenter.com or a loopback origin'
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

	// SSO: identity already knows this browser. Issue a code without VATSIM.
	const existing = getCookie(c, 'identity_session', 'host');
	if (existing) {
		const session = await validateSession(db, existing);
		if (session) {
			const { code } = await createAuthorizationCode(db, session.cid, redirectUri, clientId);
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

const AuthorizationCodeSchema = z.object({
	code: z.string().min(1).max(2048),
	redirect_uri: z.string().min(1).max(2048),
	client_id: z.string().min(1).max(2048).optional()
});

oauthRoutes.post('/token', async (c) => {
	if (!isFormContentType(c)) {
		return oauthError(c, 'invalid_request', 'body must be application/x-www-form-urlencoded');
	}
	const form = await parseFormBody(c);
	const credentials = parseClientCredentials(c.req.header('Authorization'), form);
	if (credentials === 'invalid') {
		return oauthError(c, 'invalid_request', 'use exactly one client authentication method');
	}
	const db = makeDb(c.env.DB);
	c.header('Cache-Control', 'no-store');
	c.header('Pragma', 'no-cache');

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
	const registered = await findClient(db, clientId);
	if (registered || credentials) {
		const ok =
			registered && credentials && (await authenticateClient(db, clientId, credentials.secret));
		if (!ok) {
			return invalidClient(c);
		}
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
	return c.json({
		access_token: minted.token,
		token_type: 'Bearer',
		expires_in: Math.floor((minted.expiresAt - Date.now()) / 1000)
	});
});

oauthRoutes.get('/userinfo', async (c) => {
	const token = bearerToken(c);
	const db = makeDb(c.env.DB);
	const session = token ? await validateSession(db, token) : null;
	const user = session ? await getUser(db, session.cid) : null;
	if (!user) {
		c.header('WWW-Authenticate', 'Bearer error="invalid_token"');
		return c.json({ error: 'invalid_token' }, 401);
	}
	const [roles, activeSession, activeFlightPlan] = await Promise.all([
		listRoles(db, user.cid),
		getActiveSession(user.cid),
		getFlightPlan(user.cid)
	]);
	c.header('Cache-Control', 'no-store');
	return c.json({
		...toClaims(user, roles),
		email: user.email,
		active_session: activeSession,
		active_flight_plan: activeFlightPlan
	});
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
		const db = makeDb(c.env.DB);
		await Promise.all([
			deleteSessionByToken(db, parsed.data.token),
			revokeClientToken(db, parsed.data.token)
		]);
	}
	return c.body(null, 200);
});
