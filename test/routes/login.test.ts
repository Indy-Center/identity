import { SELF } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';

describe('GET /login', () => {
	it('redirects to VATSIM authorize URL with state cookie set', async () => {
		const res = await SELF.fetch('https://auth.flyindycenter.com/login', { redirect: 'manual' });
		expect(res.status).toBe(302);

		const location = res.headers.get('Location');
		expect(location).not.toBeNull();
		const url = new URL(location!);
		expect(url.origin).toBe('https://auth.vatsim.net');
		expect(url.pathname).toBe('/oauth/authorize');
		expect(url.searchParams.get('client_id')).toBe('test_client_id');
		expect(url.searchParams.get('redirect_uri')).toBe(
			'https://auth.flyindycenter.com/login/callback'
		);
		const state = url.searchParams.get('state');
		expect(state).toBeTruthy();

		const setCookies = res.headers.getSetCookie();
		const stateCookie = setCookies.find((c) => c.startsWith('__Host-oauth_state='));
		expect(stateCookie).toBeDefined();
		expect(stateCookie).toContain(`__Host-oauth_state=${state}`);
		expect(stateCookie).toContain('HttpOnly');
		expect(stateCookie).toContain('SameSite=Lax');
	});

	it('persists return_url in __Host-oauth_return when allowed', async () => {
		const res = await SELF.fetch(
			'https://auth.flyindycenter.com/login?return_url=' +
				encodeURIComponent('https://app.flyindycenter.com/dashboard'),
			{ redirect: 'manual' }
		);
		expect(res.status).toBe(302);
		const setCookies = res.headers.getSetCookie();
		const ret = setCookies.find((c) => c.startsWith('__Host-oauth_return='));
		expect(ret).toContain('app.flyindycenter.com');
	});

	it('rejects an off-domain return_url with 400', async () => {
		const res = await SELF.fetch(
			'https://auth.flyindycenter.com/login?return_url=' + encodeURIComponent('https://evil.com/x'),
			{ redirect: 'manual' }
		);
		expect(res.status).toBe(400);
		const body = (await res.json()) as { error: { code: string } };
		expect(body.error.code).toBe('invalid_return_url');
	});
});
