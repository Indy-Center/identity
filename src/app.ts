import { Hono } from 'hono';
import type { Env, AppVariables } from './env';
import { healthRoutes } from './routes/health';

export function buildApp() {
	const app = new Hono<{ Bindings: Env; Variables: AppVariables }>();
	app.route('/healthz', healthRoutes);
	return app;
}
