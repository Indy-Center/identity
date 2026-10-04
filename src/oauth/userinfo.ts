import type { DB } from '../db';
import type { User } from '../schema';
import { toClaims } from '../users/claims';
import { listRoles } from '../users/roles';
import { getActiveSession } from '../incubator/presence/domain';
import { getFlightPlan } from '../incubator/flight-plans/domain';

/** What a user sees about themself, at /oauth/userinfo and /me: claims, email and live VATSIM activity. */
export async function userinfo(db: DB, user: User) {
	const [roles, activeSession, activeFlightPlan] = await Promise.all([
		listRoles(db, user.cid),
		getActiveSession(user.cid),
		getFlightPlan(user.cid)
	]);
	return {
		...toClaims(user, roles),
		email: user.email,
		active_session: activeSession,
		active_flight_plan: activeFlightPlan
	};
}
