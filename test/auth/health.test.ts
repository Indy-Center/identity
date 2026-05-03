import { exports } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';

describe('GET /healthz', () => {
	it('returns 200 with {ok: true}', async () => {
		const res = await exports.default.fetch('https://auth.flyindycenter.com/healthz');
		expect(res.status).toBe(200);
		expect(await res.json()).toEqual({ ok: true });
	});
});
