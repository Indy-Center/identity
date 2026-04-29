import { WorkerEntrypoint } from 'cloudflare:workers';
import { buildApp } from './app';
import type { Env } from './env';

const app = buildApp();

export default class Identity extends WorkerEntrypoint<Env> {
	fetch(request: Request) {
		return app.fetch(request, this.env, this.ctx);
	}
}
