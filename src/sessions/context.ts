// src/sessions/context.ts
// The consumer session API: what /oauth/userinfo and /oauth/revoke
// (src/oauth/routes.ts) do, independent of HTTP.
import { makeDb } from '../db';
import * as users from '../users/domain';
import * as sessions from './domain';
import * as roles from '../roles/domain';
import * as onlineControllers from '../online-controllers/domain';
import * as flightPlans from '../flight-plans/domain';
import type { User } from '../schema';
import type { OnlineController } from '../online-controllers/types';
import type { FlightPlan } from '../flight-plans/types';

export type SessionContext = {
	user: User;
	roles: string[];
	sessionExpiresAt: Date;
	activeSession: OnlineController | null;
	activeFlightPlan: FlightPlan | null;
};

export function serializeUserinfo(ctx: SessionContext) {
	const { name_full, name_first, name_last } = ctx.user.vatsimData.personal;
	return {
		sub: ctx.user.id,
		email: ctx.user.email,
		name: name_full || [name_first, name_last].filter(Boolean).join(' '),
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
