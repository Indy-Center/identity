import { exports } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';

type OpenApiDoc = {
	openapi: string;
	paths: Record<string, Record<string, { responses?: Record<string, unknown> }> | undefined>;
	components?: { schemas?: Record<string, { properties?: Record<string, unknown> }> };
};

function operation(doc: OpenApiDoc, path: string, method: string) {
	const op = doc.paths[path]?.[method];
	if (!op) {
		throw new Error(`no ${method.toUpperCase()} ${path} in the spec`);
	}
	return op;
}

describe('API docs', () => {
	it('serves an OpenAPI document covering /api and /oauth', async () => {
		const res = await exports.default.fetch('https://id.flyindycenter.com/openapi.json');
		expect(res.status).toBe(200);
		expect(res.headers.get('Cache-Control')).toBe('public, max-age=300');
		const doc = (await res.json()) as {
			openapi: string;
			paths: Record<string, Record<string, unknown>>;
			components?: { securitySchemes?: Record<string, { type: string; scheme?: string }> };
		};
		expect(doc.openapi).toMatch(/^3\./);
		for (const path of [
			'/api/users',
			'/api/users/{cid}',
			'/api/users/{cid}/roles',
			'/api/me',
			'/oauth/authorize',
			'/oauth/token',
			'/oauth/userinfo',
			'/oauth/revoke'
		]) {
			expect(doc.paths, path).toHaveProperty([path]);
		}
		expect(doc.components?.securitySchemes?.bearerAuth).toMatchObject({
			type: 'http',
			scheme: 'bearer'
		});
	});

	it('renders Scalar at /docs', async () => {
		const res = await exports.default.fetch('https://id.flyindycenter.com/docs');
		expect(res.status).toBe(200);
		expect(res.headers.get('Cache-Control')).toBe('public, max-age=300');
		expect(await res.text()).toContain('/openapi.json');
	});

	// Guards against a hono-openapi upgrade silently dropping request bodies:
	// validate('json', …) wraps the real validator and copies its schema
	// metadata onto the wrapper, which is easy to break by accident.
	it('includes requestBody for PATCH routes validated with validate("json", …)', async () => {
		const res = await exports.default.fetch('https://id.flyindycenter.com/openapi.json');
		const doc = (await res.json()) as {
			paths: Record<string, Record<string, { requestBody?: unknown }> | undefined>;
		};
		expect(doc.paths['/api/users/{cid}']?.patch?.requestBody).toBeDefined();
		expect(doc.paths['/api/me']?.patch?.requestBody).toBeDefined();
	});

	// hono-openapi's own default 400 body is {success,error,data}; ours is
	// error-handler.ts's real envelope. Resolve whatever the 400 response
	// schema is (inline or via $ref) and check it describes the real shape.
	it("documents the real error envelope for 400, not hono-openapi's default", async () => {
		const res = await exports.default.fetch('https://id.flyindycenter.com/openapi.json');
		const doc = (await res.json()) as OpenApiDoc;
		const response = operation(doc, '/api/users', 'get').responses?.['400'] as
			| { content?: { 'application/json'?: { schema?: unknown } } }
			| undefined;
		let schema = response?.content?.['application/json']?.schema as
			| { $ref?: string; properties?: Record<string, unknown> }
			| undefined;
		if (schema?.$ref) {
			const name = schema.$ref.split('/').pop()!;
			schema = doc.components?.schemas?.[name];
		}
		expect(schema?.properties).toHaveProperty('error');
		expect(schema?.properties).not.toHaveProperty('success');
	});

	// The success/error responses documented directly on the /api routes.
	it('documents success and error responses on the /api routes', async () => {
		const res = await exports.default.fetch('https://id.flyindycenter.com/openapi.json');
		const doc = (await res.json()) as OpenApiDoc;
		expect(operation(doc, '/api/users', 'get').responses).toMatchObject({
			200: {},
			401: {},
			403: {}
		});
		expect(operation(doc, '/api/users/{cid}', 'get').responses).toMatchObject({
			200: {},
			401: {},
			403: {},
			404: {}
		});
		expect(operation(doc, '/api/users/{cid}', 'patch').responses).toMatchObject({
			200: {},
			401: {},
			403: {},
			404: {},
			409: {}
		});
		expect(operation(doc, '/api/users/{cid}/roles', 'get').responses).toMatchObject({
			200: {},
			401: {},
			403: {}
		});
		expect(operation(doc, '/api/users/{cid}/roles', 'patch').responses).toMatchObject({
			200: {},
			401: {},
			403: {}
		});
		expect(operation(doc, '/api/me', 'patch').responses).toMatchObject({
			200: {},
			401: {},
			403: {}
		});
	});

	it('pins the Scalar CDN bundle and disables the external request proxy', async () => {
		const res = await exports.default.fetch('https://id.flyindycenter.com/docs');
		const body = await res.text();
		expect(body).toMatch(/cdn\.jsdelivr\.net\/npm\/@scalar\/api-reference@\d+\.\d+\.\d+/);
		expect(body).toContain('"proxyUrl": ""');
	});

	// The exclude list was dropped as redundant: hono-openapi only lists routes
	// carrying a describeRoute()/validate() marker, and none of these do. This
	// pins that behavior so a future describeRoute() on one of them is a
	// deliberate, visible choice rather than a surprise appearance in the docs.
	it('never lists undescribed routes (/healthz, /docs, /openapi.json, /login/callback, /logout)', async () => {
		const res = await exports.default.fetch('https://id.flyindycenter.com/openapi.json');
		const doc = (await res.json()) as OpenApiDoc;
		for (const path of ['/healthz', '/docs', '/openapi.json', '/login/callback', '/logout']) {
			expect(doc.paths, path).not.toHaveProperty([path]);
		}
	});

	it('sets a Content-Security-Policy on /docs but not on /openapi.json', async () => {
		const docs = await exports.default.fetch('https://id.flyindycenter.com/docs');
		const csp = docs.headers.get('Content-Security-Policy');
		expect(csp).toBeTruthy();
		expect(csp).toContain("frame-ancestors 'none'");
		expect(csp).toContain('https://cdn.jsdelivr.net');

		const spec = await exports.default.fetch('https://id.flyindycenter.com/openapi.json');
		expect(spec.headers.get('Content-Security-Policy')).toBeNull();
	});
});
