import { WorkerEntrypoint } from 'cloudflare:workers';
import { buildApp } from './app';
import * as users from './rpc/users';
import * as sessions from './rpc/sessions';
import * as roles from './rpc/roles';
import * as profile from './rpc/profile';
import type { Env } from './env';

const app = buildApp();

export default class Identity extends WorkerEntrypoint<Env> {
	fetch(request: Request) {
		return app.fetch(request, this.env, this.ctx);
	}

	getUserById(id: string) {
		return users.getById(this.env, id);
	}
	getUserByCid(cid: string) {
		return users.getByCid(this.env, cid);
	}
	listUsersByRole(role: string) {
		return users.listByRole(this.env, role);
	}

	validateSession(token: string) {
		return sessions.validate(this.env, token);
	}
	invalidateSession(token: string) {
		return sessions.invalidate(this.env, token);
	}
	invalidateUserSessions(userId: string) {
		return sessions.invalidateAllForUser(this.env, userId);
	}

	addRole(userId: string, role: string, opts?: { grantedBy?: string }) {
		return roles.add(this.env, userId, role, opts);
	}
	removeRole(userId: string, role: string) {
		return roles.remove(this.env, userId, role);
	}
	setRoles(userId: string, list: string[], opts?: { grantedBy?: string }) {
		return roles.set(this.env, userId, list, opts);
	}
	getRoles(userId: string) {
		return roles.get(this.env, userId);
	}

	updateProfile(userId: string, patch: profile.ProfilePatch) {
		return profile.update(this.env, userId, patch);
	}
}
