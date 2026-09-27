// src/api/principal.ts
// Who is calling /api/*: a client-credentials token or a user's access token.
// Both are opaque and looked up by sha256. Routes then ask what the principal
// may do (requireScope) and whom to attribute role writes to (roleSource).
import { createMiddleware } from 'hono/factory';
import { makeDb } from '../db';
import { IdentityError } from '../errors';
import type { Scope } from '../schema';
import { hasScope, validateClientToken } from '../clients/domain';
import { validateSession } from '../sessions/domain';
import { listRoles } from '../users/roles';

export type Principal =
	| { kind: 'client'; id: string; scopes: Scope[] }
	| { kind: 'user'; cid: string; roles: string[] };

export type ApiEnv = { Bindings: Cloudflare.Env; Variables: { principal: Principal } };

// Same parsing as /oauth/userinfo: header only (never a cookie), case-insensitive scheme.
const BEARER = /^Bearer\s+(\S+)$/i;
export const GLOBAL_ADMIN = 'global:admin';

export const principal = createMiddleware<ApiEnv>(async (c, next) => {
	const token = c.req.header('Authorization')?.match(BEARER)?.[1];
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
		c.set('principal', { kind: 'user', cid: session.cid, roles: await listRoles(db, session.cid) });
		return next();
	}
	c.header('WWW-Authenticate', 'Bearer error="invalid_token"');
	throw new IdentityError('unauthenticated', 401, 'token is invalid or expired');
});

/** Clients by their granted scopes; users only via global:admin (both scopes). */
export function can(p: Principal, scope: Scope): boolean {
	return p.kind === 'client' ? hasScope(p.scopes, scope) : p.roles.includes(GLOBAL_ADMIN);
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

/** The `source` recorded on role rows this principal writes. */
export function roleSource(p: Principal): string {
	return p.kind === 'client' ? p.id : `user:${p.cid}`;
}
