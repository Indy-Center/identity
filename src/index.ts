// src/index.ts
import { WorkerEntrypoint } from 'cloudflare:workers';
import { buildApp } from './app';
import { makeDb } from './db';
import * as users from './users/domain';
import * as sessions from './sessions/domain';
import * as roles from './roles/domain';
import * as onlineControllers from './online-controllers/domain';
import * as flightPlans from './flight-plans/domain';
import { getFixtureFlightPlan, getFixtureOnlineController } from './dev-fixtures';
import type { AttributePatch } from './client/attributes';
import type { IdentityRpc } from './client/api';
import type { SessionContext } from './client/session-context';

const app = buildApp();

export default class Identity extends WorkerEntrypoint<Cloudflare.Env> implements IdentityRpc {
	private get db() {
		return makeDb(this.env.DB);
	}

	fetch(request: Request) {
		return app.fetch(request, this.env, this.ctx);
	}

	// user reads
	getUserById(id: string) {
		return users.getById(this.db, id);
	}
	getUserByCid(cid: string) {
		return users.getByCid(this.db, cid);
	}
	getUserByEmail(email: string) {
		return users.getByEmail(this.db, email);
	}
	listUsers() {
		return users.listAll(this.db);
	}
	listUsersByRole(role: string) {
		return users.listByRole(this.db, role);
	}
	listOperatingInitials() {
		return users.listOperatingInitials(this.db);
	}

	// user writes
	setAttributes(userId: string, patch: AttributePatch) {
		return users.setAttributes(this.db, userId, patch);
	}
	setUserActive(userId: string, active: boolean, opts?: { reason?: string; changedBy?: string }) {
		return users.setUserActive(this.db, userId, active, opts);
	}

	// sessions
	async getSessionContext(token: string): Promise<SessionContext | null> {
		const session = await sessions.validateSession(this.db, token);
		if (!session) {
			return null;
		}
		const user = await users.getById(this.db, session.userId);
		if (!user) {
			return null;
		}
		const roleRows = await roles.get(this.db, user.id);
		// Dev fixtures win over live feeds when COOKIE_DOMAIN === 'localhost'.
		// Returns null in production, so the live-feed lookups always run there.
		const fixtureSession = getFixtureOnlineController(this.env, user.cid);
		const fixtureFlightPlan = getFixtureFlightPlan(this.env, user.cid);
		const [liveSession, liveFlightPlan] = await Promise.all([
			fixtureSession ? Promise.resolve(null) : onlineControllers.getActiveSession(user.cid),
			fixtureFlightPlan ? Promise.resolve(null) : flightPlans.getFlightPlan(user.cid)
		]);
		return {
			user,
			roles: roleRows,
			sessionExpiresAt: new Date(session.expiresAt),
			activeSession: fixtureSession ?? liveSession,
			activeFlightPlan: fixtureFlightPlan ?? liveFlightPlan
		};
	}
	invalidateSession(token: string) {
		return sessions.deleteSessionByToken(this.db, token);
	}
	invalidateUserSessions(userId: string) {
		return sessions.deleteAllSessionsForUser(this.db, userId);
	}

	// roles
	addRole(userId: string, role: string, opts?: { grantedBy?: string }) {
		return roles.add(this.db, userId, role, opts);
	}
	removeRole(userId: string, role: string) {
		return roles.remove(this.db, userId, role);
	}
	setRoles(userId: string, list: string[], opts?: { grantedBy?: string }) {
		return roles.set(this.db, userId, list, opts);
	}
	getRoles(userId: string) {
		return roles.get(this.db, userId);
	}
}
