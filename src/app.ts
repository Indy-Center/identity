import { Hono } from 'hono';
import { openAPIRouteHandler } from 'hono-openapi';
import { Scalar } from '@scalar/hono-api-reference';
import { errorHandler, notFoundHandler } from './error-handler';
import { loginRoutes, logoutRoutes } from './oauth/login-routes';
import { oauthRoutes } from './oauth/routes';
import { apiRoutes } from './users/routes';

const DOCS_CACHE = 'public, max-age=300';

export function buildApp() {
	const app = new Hono<{ Bindings: Cloudflare.Env }>();
	app.onError(errorHandler);
	app.notFound(notFoundHandler);
	// /healthz inlined — single endpoint, doesn't need its own router
	app.get('/healthz', (c) => c.json({ ok: true }));
	app.route('/oauth', oauthRoutes);
	app.route('/login', loginRoutes);
	app.route('/logout', logoutRoutes);
	app.route('/api', apiRoutes);

	app.use('/openapi.json', async (c, next) => {
		await next();
		c.header('Cache-Control', DOCS_CACHE);
	});
	app.get(
		'/openapi.json',
		openAPIRouteHandler(app, {
			documentation: {
				info: {
					title: 'Indy Center identity',
					version: '2.0.0',
					description:
						'OAuth 2.0 authorization server for *.flyindycenter.com, brokering VATSIM Connect, plus the /api service API.'
				},
				servers: [{ url: 'https://id.flyindycenter.com' }],
				components: {
					securitySchemes: {
						bearerAuth: {
							type: 'http',
							scheme: 'bearer',
							description: 'A client-credentials token or a user access token from /oauth/token'
						}
					}
				}
			},
			exclude: ['/healthz', '/openapi.json', '/docs', '/login/callback', '/logout']
		})
	);
	app.get(
		'/docs',
		async (c, next) => {
			await next();
			c.header('Cache-Control', DOCS_CACHE);
		},
		Scalar({ url: '/openapi.json', pageTitle: 'identity API' })
	);
	return app;
}
