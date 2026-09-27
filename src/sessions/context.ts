// src/sessions/context.ts
// The consumer session API: what /oauth/userinfo and /oauth/revoke
// (src/oauth/routes.ts) do, independent of HTTP.
import { makeDb } from '../db';
import * as users from '../users/domain';
import * as sessions from './domain';
import * as roles from '../users/roles';
import * as onlineControllers from '../incubator/presence/domain';
import * as flightPlans from '../incubator/flight-plans/domain';
import type { User } from '../schema';
import type { OnlineController } from '../incubator/presence/types';
import type { FlightPlan } from '../incubator/flight-plans/types';

export type SessionContext = {
	user: User;
	roles: string[];
	sessionExpiresAt: Date;
	activeSession: OnlineController | null;
	activeFlightPlan: FlightPlan | null;
};

export function serializeUserinfo(ctx: SessionContext) {
	return {
		sub: ctx.user.cid,
		email: ctx.user.email,
		name: [ctx.user.firstName, ctx.user.lastName].filter(Boolean).join(' '),
		...ctx,
		sessionExpiresAt: ctx.sessionExpiresAt.toISOString()
	};
}

export async function getSessionContext(
	env: Cloudflare.Env,
	token: string
): Promise<SessionContext | null> {
	const db = makeDb(env.DB);
	const session = await sessions.validateSession(db, token);
	if (!session) {
		return null;
	}
	const user = await users.getUser(db, session.cid);
	if (!user) {
		return null;
	}
	const [roleRows, activeSession, activeFlightPlan] = await Promise.all([
		roles.listRoles(db, user.cid),
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
