// Who is calling /api/*: a client-credentials token or a user's access token.
// Both are opaque and looked up by sha256. Routes then ask what the principal
// may do (requireScope) and whom to attribute role writes to (roleSource).
import { createMiddleware } from 'hono/factory';
import { makeDb } from '../db';
import { IdentityError } from '../errors';
import type { Scope } from '../schema';
import { findClient, hasScope, validateClientToken } from '../clients/domain';
import { validateSession } from '../sessions/domain';
import { listRoles } from '../users/roles';

export type Principal =
	| { kind: 'client'; id: string; scopes: Scope[] }
	| { kind: 'user'; cid: string; roles: string[]; scopes: Scope[] };

export type ApiEnv = { Bindings: Cloudflare.Env; Variables: { principal: Principal } };

const BEARER = /^Bearer\s+(\S+)$/i;
const GLOBAL_ADMIN = 'global:admin';

/** The bearer token from the Authorization header: never a cookie, case-insensitive scheme. */
export function bearerToken(authorization: string | undefined): string | undefined {
	return authorization?.match(BEARER)?.[1];
}

export const principal = createMiddleware<ApiEnv>(async (c, next) => {
	const token = bearerToken(c.req.header('Authorization'));
	// RFC 6750 §3: challenge on every 401; no error code when no token was sent.
	if (!token) {
		c.header('WWW-Authenticate', 'Bearer');
		throw new IdentityError('unauthenticated', 401, 'bearer token required');
	}
	const db = makeDb(c.env.DB);
	// Client tokens and sessions live in separate tables, each keyed by the
	// sha256 of an independently random token, so a token resolves to one kind.
	const client = await validateClientToken(db, token);
	if (client) {
		c.set('principal', { kind: 'client', id: client.clientId, scopes: client.scopes });
		return next();
	}
	// validateSession rejects expired sessions and disabled users.
	const session = await validateSession(db, token);
	if (session) {
		// A user's token can do no more than the client it was issued through:
		// an unregistered or since-deleted client has no scopes.
		const [roles, issuedTo] = await Promise.all([
			listRoles(db, session.cid),
			session.clientId ? findClient(db, session.clientId) : null
		]);
		c.set('principal', { kind: 'user', cid: session.cid, roles, scopes: issuedTo?.scopes ?? [] });
		return next();
	}
	c.header('WWW-Authenticate', 'Bearer error="invalid_token"');
	throw new IdentityError('unauthenticated', 401, 'token is invalid or expired');
});

/**
 * Whether the token carries `scope`, and for a user's token, whether the user
 * is also a global:admin. Both must hold, so the stricter of the two wins.
 */
function can(p: Principal, scope: Scope): boolean {
	return hasScope(p.scopes, scope) && (p.kind === 'client' || p.roles.includes(GLOBAL_ADMIN));
}

export function requireScope(scope: Scope) {
	return createMiddleware<ApiEnv>(async (c, next) => {
		if (!can(c.var.principal, scope)) {
			c.header('WWW-Authenticate', `Bearer error="insufficient_scope", scope="${scope}"`);
			throw new IdentityError('insufficient_scope', 403, `requires ${scope}`);
		}
		return next();
	});
}

/**
 * Client management: a global:admin user, logged in through a client that
 * holds clients:manage. Never a service's own token, whatever its scopes.
 */
export const requireAdmin = createMiddleware<ApiEnv>(async (c, next) => {
	const p = c.var.principal;
	if (p.kind !== 'user' || !can(p, 'clients:manage')) {
		throw new IdentityError(
			'access_denied',
			403,
			`requires a ${GLOBAL_ADMIN} user, logged in through a client with clients:manage`
		);
	}
	return next();
});

/** The `source` recorded on role rows this principal writes. */
export function roleSource(p: Principal): string {
	return p.kind === 'client' ? p.id : `user:${p.cid}`;
}
