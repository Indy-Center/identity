// src/index.ts
import { WorkerEntrypoint } from 'cloudflare:workers';
import { buildApp } from './app';
import { makeDb } from './db';
import * as users from './users/domain';
import * as sessions from './sessions/domain';
import * as roles from './roles/domain';
import * as onlineControllers from './online-controllers/domain';
import * as flightPlans from './flight-plans/domain';
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

	async getSessionContext(token: string): Promise<SessionContext | null> {
		const session = await sessions.validateSession(this.db, token);
		if (!session) {
			return null;
		}
		const user = await users.getById(this.db, session.userId);
		if (!user) {
			return null;
		}
		const [roleRows, activeSession, activeFlightPlan] = await Promise.all([
			roles.get(this.db, user.id),
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

	logout(token: string): Promise<void> {
		return sessions.deleteSessionByToken(this.db, token);
	}
}
