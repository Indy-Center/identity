import { exports } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';

const USERINFO = 'https://auth.flyindycenter.com/oauth/userinfo';

describe('CORS on /oauth', () => {
	it('reflects an allowed loopback origin, without credentials', async () => {
		const res = await exports.default.fetch(USERINFO, {
			headers: { Origin: 'http://localhost:5173' }
		});
		expect(res.headers.get('Access-Control-Allow-Origin')).toBe('http://localhost:5173');
		expect(res.headers.get('Access-Control-Allow-Credentials')).toBeNull();
	});

	it('reflects an allowed production origin', async () => {
		const res = await exports.default.fetch(USERINFO, {
			headers: { Origin: 'https://charts.flyindycenter.com' }
		});
		expect(res.headers.get('Access-Control-Allow-Origin')).toBe('https://charts.flyindycenter.com');
	});

	it('sets no allow-origin for a disallowed origin', async () => {
		for (const origin of ['https://evil.com', 'https://flyindycenter.com.evil.com']) {
			const res = await exports.default.fetch(USERINFO, { headers: { Origin: origin } });
			expect(res.headers.get('Access-Control-Allow-Origin')).toBeNull();
		}
	});

	it('answers a preflight for an allowed origin', async () => {
		const res = await exports.default.fetch('https://auth.flyindycenter.com/oauth/token', {
			method: 'OPTIONS',
			headers: {
				Origin: 'http://localhost:5173',
				'Access-Control-Request-Method': 'POST',
				'Access-Control-Request-Headers': 'content-type'
			}
		});
		expect(res.status).toBe(204);
		expect(res.headers.get('Access-Control-Allow-Origin')).toBe('http://localhost:5173');
		expect(res.headers.get('Access-Control-Allow-Methods')).toBe('GET,POST,OPTIONS');
		expect(res.headers.get('Access-Control-Allow-Headers')).toBe('Authorization,Content-Type');
	});
});
