import { Hono } from 'hono';
import type { Env, AppVariables } from './env';
import { errorHandler } from './middleware/error';
import { healthRoutes } from './routes/health';
import { loginRoutes } from './routes/login';

export function buildApp() {
	const app = new Hono<{ Bindings: Env; Variables: AppVariables }>();
	app.onError(errorHandler);
	app.route('/healthz', healthRoutes);
	app.route('/login', loginRoutes);
	return app;
}
