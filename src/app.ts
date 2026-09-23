import { Hono } from 'hono';
import { errorHandler } from './error-handler';
import { loginRoutes, logoutRoutes } from './auth/routes';
import { oauthRoutes } from './oauth/routes';

export function buildApp() {
	const app = new Hono<{ Bindings: Cloudflare.Env }>();
	app.onError(errorHandler);
	// /healthz inlined — single endpoint, doesn't need its own router
	app.get('/healthz', (c) => c.json({ ok: true }));
	app.route('/oauth', oauthRoutes);
	app.route('/login', loginRoutes);
	app.route('/logout', logoutRoutes);
	return app;
}
