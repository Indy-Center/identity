import { Hono } from 'hono';
import { openAPIRouteHandler } from 'hono-openapi';
import { Scalar } from '@scalar/hono-api-reference';
import { secureHeaders } from 'hono/secure-headers';
import { errorHandler, notFoundHandler } from './error-handler';
import { loginRoutes, logoutRoutes } from './oauth/login-routes';
import { oauthRoutes } from './oauth/routes';
import { apiRoutes } from './users/routes';
import { defaultValidationErrorResponse, errorSchemas } from './openapi';

const DOCS_CACHE = 'public, max-age=300';

// Pinned to the @scalar/api-reference release that shipped alongside the
// installed @scalar/hono-api-reference@0.12.6 (both from the same release,
// per npm publish times). A `cdn` URL also selects the single-file UMD
// bundle over the default code-split ESM build, which is what keeps the CSP
// below free of 'strict-dynamic' or per-chunk allowlisting.
const SCALAR_CDN = 'https://cdn.jsdelivr.net/npm/@scalar/api-reference@1.72.1';

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
					},
					schemas: errorSchemas
				}
			},
			defaultValidationErrorResponse
			// No exclude list needed: hono-openapi only lists routes carrying a
			// describeRoute()/validate() marker, and /healthz, /openapi.json,
			// /docs, /login/callback and /logout carry none — verified by
			// asserting their absence in test/docs.test.ts.
		})
	);
	// CSP scoped to /docs only: the rest of the API returns JSON, not HTML, so
	// it has no inline scripts/styles to defend against in the first place.
	app.use(
		'/docs',
		secureHeaders({
			contentSecurityPolicy: {
				defaultSrc: ["'none'"],
				scriptSrc: ["'self'", "'unsafe-inline'", 'https://cdn.jsdelivr.net'],
				// Scalar renders inline style="..." attributes a CSP nonce can't cover.
				styleSrc: ["'self'", "'unsafe-inline'"],
				fontSrc: ['https://fonts.scalar.com'],
				imgSrc: ["'self'", 'data:'],
				// Same-origin only: "Try it" must never be able to reach an
				// external proxy or any host but this one (see proxyUrl below).
				connectSrc: ["'self'"],
				frameAncestors: ["'none'"]
			}
		})
	);
	app.get(
		'/docs',
		async (c, next) => {
			await next();
			c.header('Cache-Control', DOCS_CACHE);
		},
		Scalar({
			url: '/openapi.json',
			pageTitle: 'identity API',
			cdn: SCALAR_CDN,
			// The default is Scalar's own hosted proxy (proxy.scalar.com), which
			// would otherwise carry every "Try it" request — and any bearer
			// token typed into it — through a third party. '' disables it;
			// requests go straight from the browser to the API origin instead.
			proxyUrl: ''
		})
	);
	return app;
}
