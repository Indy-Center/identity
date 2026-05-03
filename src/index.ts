import { WorkerEntrypoint } from 'cloudflare:workers';
import { buildApp } from './app';
import { makeDb } from './db';
import * as users from './users/domain';
import * as sessions from './sessions/domain';
import * as roles from './roles/domain';
import type { AttributePatch } from './client/attributes';
import type { IdentityRpc } from './client/api';

const app = buildApp();

export default class Identity extends WorkerEntrypoint<Cloudflare.Env> implements IdentityRpc {
	// One-liner accessor — the actual caching lives in db.ts (WeakMap keyed
	// by the underlying D1 binding), so this just looks the wrapper up.
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
	validateSession(token: string) {
		return sessions.getSessionPayload(this.db, token);
	}
	async getCurrentUser(token: string) {
		const session = await sessions.validateSession(this.db, token);
		if (!session) return null;
		return users.getById(this.db, session.userId);
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
