import { exports } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';

describe('GET /.well-known/oauth-authorization-server', () => {
	it('publishes RFC 8414 metadata for the origin it is served from', async () => {
		const res = await exports.default.fetch(
			'https://id.flyindycenter.com/.well-known/oauth-authorization-server',
			{ headers: { Origin: 'https://moodle.example.org' } }
		);
		expect(res.status).toBe(200);
		expect(res.headers.get('Access-Control-Allow-Origin')).toBe('*');
		expect(await res.json()).toEqual({
			issuer: 'https://id.flyindycenter.com',
			authorization_endpoint: 'https://id.flyindycenter.com/oauth/authorize',
			token_endpoint: 'https://id.flyindycenter.com/oauth/token',
			userinfo_endpoint: 'https://id.flyindycenter.com/oauth/userinfo',
			revocation_endpoint: 'https://id.flyindycenter.com/oauth/revoke',
			response_types_supported: ['code'],
			grant_types_supported: ['authorization_code', 'client_credentials'],
			token_endpoint_auth_methods_supported: ['client_secret_basic', 'client_secret_post', 'none'],
			revocation_endpoint_auth_methods_supported: ['none'],
			scopes_supported: ['users:read', 'users:write', 'clients:manage'],
			service_documentation: 'https://id.flyindycenter.com/docs'
		});
	});

	it('every advertised endpoint is a real route', async () => {
		const res = await exports.default.fetch(
			'https://id.flyindycenter.com/.well-known/oauth-authorization-server'
		);
		const doc = (await res.json()) as Record<string, unknown>;
		for (const key of Object.keys(doc).filter((k) => k.endsWith('_endpoint'))) {
			const method = key === 'token_endpoint' || key === 'revocation_endpoint' ? 'POST' : 'GET';
			const probe = await exports.default.fetch(doc[key] as string, { method });
			expect(probe.status, key).not.toBe(404);
		}
	});
});
