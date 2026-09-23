// src/sessions/context.ts
// The consumer session API: what /oauth/token, /oauth/userinfo and
// /oauth/revoke (src/oauth/routes.ts) do, independent of HTTP.
import { makeDb } from '../db';
import * as users from '../users/domain';
import * as sessions from './domain';
import * as roles from '../roles/domain';
import * as onlineControllers from '../online-controllers/domain';
import * as flightPlans from '../flight-plans/domain';
import { exchangeAuthorizationCode } from '../authorization-codes/domain';
import { IdentityError } from '../client/errors';
import type { SessionContext } from '../client/session-context';

export type ExchangedSession = { token: string; expiresAt: Date; session: SessionContext };

export async function getSessionContext(
	env: Cloudflare.Env,
	token: string
): Promise<SessionContext | null> {
	const db = makeDb(env.DB);
	const session = await sessions.validateSession(db, token);
	if (!session) {
		return null;
	}
	const user = await users.getById(db, session.userId);
	if (!user) {
		return null;
	}
	const [roleRows, activeSession, activeFlightPlan] = await Promise.all([
		roles.get(db, user.id),
		onlineControllers.getActiveSession(user.cid),
		flightPlans.getFlightPlan(user.cid)
	]);
	return {
		user,
		roles: roleRows,
		sessionExpiresAt: new Date(session.expiresAt),
		activeSession,
		activeFlightPlan
	};
}

export function logout(env: Cloudflare.Env, token: string): Promise<void> {
	return sessions.deleteSessionByToken(makeDb(env.DB), token);
}

export async function exchangeCodeForSession(
	env: Cloudflare.Env,
	code: string,
	redirectUri: string
): Promise<ExchangedSession> {
	const minted = await exchangeAuthorizationCode(makeDb(env.DB), code, redirectUri);
	if (!minted) {
		throw new IdentityError(
			'invalid_code',
			400,
			'authorization code is invalid, expired, or was issued for a different redirect_uri'
		);
	}
	const session = await getSessionContext(env, minted.token);
	if (!session) {
		// getSessionContext returns null when validateSession's join on users.isActive
		// excludes the row — i.e. the user was disabled between code issuance and
		// exchange. That's an access decision, not an internal fault.
		throw new IdentityError('access_denied', 403, 'account disabled');
	}
	return { token: minted.token, expiresAt: new Date(minted.expiresAt), session };
}
