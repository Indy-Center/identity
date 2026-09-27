// test/docs.test.ts
import { exports } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';

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
});
