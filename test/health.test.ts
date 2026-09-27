import { exports } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';

describe('GET /healthz', () => {
	it('returns 200 with {ok: true}', async () => {
		const res = await exports.default.fetch('https://id.flyindycenter.com/healthz');
		expect(res.status).toBe(200);
		expect(await res.json()).toEqual({ ok: true });
	});
});

describe('unknown paths', () => {
	it('404 with the error envelope', async () => {
		for (const path of ['/nope', '/oauth/nope']) {
			const res = await exports.default.fetch(`https://id.flyindycenter.com${path}`);
			expect(res.status).toBe(404);
			expect(await res.json()).toEqual({ error: { code: 'not_found', message: 'no such route' } });
		}
	});
});
