import { WorkerEntrypoint } from 'cloudflare:workers';
import { buildApp } from './app';
import * as users from './rpc/users';
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
}
