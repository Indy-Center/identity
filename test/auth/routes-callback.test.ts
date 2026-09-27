import { exports, env } from 'cloudflare:workers';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { makeDb } from '../../src/db';
import { authorizationCodes, users, sessions } from '../../src/schema';
import { upsertFromVatsim, setUserActive } from '../../src/users/domain';
import { validateSession } from '../../src/sessions/domain';

const CALLBACK = 'https://id.flyindycenter.com/login/callback?code=auth_code&state=state_xyz';
const REDIRECT = 'https://charts.flyindycenter.com/kind';

beforeEach(async () => {
	const db = makeDb(env.DB);
	await db.delete(authorizationCodes);
	await db.delete(sessions);
	await db.delete(users);
});

afterEach(() => {
	vi.restoreAllMocks();
});

// VATSIM's token endpoint, then its profile endpoint. Build each Response
// inside the mock: workerd refuses to hand a Response created in the test's
// context to the worker's request context.
function mockVatsim() {
	return vi
		.spyOn(globalThis, 'fetch')
		.mockImplementationOnce(
			async () =>
				new Response(
					JSON.stringify({ access_token: 'access_xyz', token_type: 'Bearer', expires_in: 3600 }),
					{ status: 200, headers: { 'content-type': 'application/json' } }
				)
		)
		.mockImplementationOnce(
			async () =>
				new Response(
					JSON.stringify({
						data: {
							cid: '999',
							personal: { name_first: 'Test', name_last: 'User', email: 'test@example.com' }
						}
					}),
					{ status: 200, headers: { 'content-type': 'application/json' } }
				)
		);
}

function returnCookie(redirectUri: string, state?: string): string {
	const value = encodeURIComponent(JSON.stringify({ redirectUri, clientId: 'charts', state }));
	return `__Host-oauth_return=${value}`;
}

function callback(cookie: string): Promise<Response> {
	return exports.default.fetch(CALLBACK, { redirect: 'manual', headers: { Cookie: cookie } });
}

describe('GET /login/callback', () => {
	it('sets identity’s cookie, mints a code bound to the redirect URI, and redirects with it', async () => {
		mockVatsim();
		const res = await callback(`__Host-oauth_state=state_xyz; ${returnCookie(REDIRECT, 'abc')}`);
		expect(res.status).toBe(302);

		const location = new URL(res.headers.get('Location')!);
		expect(location.origin + location.pathname).toBe(REDIRECT);
		expect(location.searchParams.get('state')).toBe('abc');
		expect(location.searchParams.get('code')).toMatch(/^[a-z2-7]{32}$/);

		const setCookies = res.headers.getSetCookie();
		const identityCookie = setCookies.find((c) => c.startsWith('__Host-identity_session='));
		expect(identityCookie).toContain('HttpOnly');
		expect(identityCookie).toContain('Secure');
		expect(identityCookie).toContain('Path=/');
		expect(identityCookie).not.toContain('Domain=');

		const legacyCookie = setCookies.find((c) => c.startsWith('fic_session=;'));
		expect(legacyCookie).toBeDefined();
		expect(legacyCookie).toContain('Domain=.flyindycenter.com');
		expect(legacyCookie).toContain('Max-Age=0');
		expect(setCookies.find((c) => c.startsWith('__Host-oauth_state='))).toContain('Max-Age=0');
		expect(setCookies.find((c) => c.startsWith('__Host-oauth_return='))).toContain('Max-Age=0');

		const db = makeDb(env.DB);
		const user = await db.select().from(users).where(eq(users.cid, '999')).get();
		expect(user).toBeTruthy();

		const allSessions = await db.select().from(sessions).all();
		expect(allSessions).toHaveLength(1);
		const token = identityCookie!.split(';')[0]!.slice('__Host-identity_session='.length);
		expect((await validateSession(db, token))?.userId).toBe(user!.id);

		const codes = await db.select().from(authorizationCodes).all();
		expect(codes).toHaveLength(1);
		expect(codes[0]!.userId).toBe(user!.id);
		expect(codes[0]!.redirectUri).toBe(REDIRECT);
	});

	it('works the same for a loopback redirect URI and omits state when none was sent', async () => {
		mockVatsim();
		const res = await callback(
			`__Host-oauth_state=state_xyz; ${returnCookie('http://localhost:5173/x?y=1')}`
		);
		expect(res.status).toBe(302);

		const location = new URL(res.headers.get('Location')!);
		expect(location.origin + location.pathname).toBe('http://localhost:5173/x');
		expect(location.searchParams.get('y')).toBe('1');
		expect(location.searchParams.get('code')).toMatch(/^[a-z2-7]{32}$/);
		expect(location.searchParams.has('state')).toBe(false);
		expect(
			res.headers.getSetCookie().find((c) => c.startsWith('__Host-identity_session='))
		).toBeDefined();
	});

	it('400s with invalid_state when the state cookie is missing', async () => {
		const res = await exports.default.fetch(
			'https://id.flyindycenter.com/login/callback?code=c&state=s',
			{ redirect: 'manual' }
		);
		expect(res.status).toBe(400);
		const body = (await res.json()) as { error: { code: string } };
		expect(body.error.code).toBe('invalid_state');
	});

	it('400s when state mismatches', async () => {
		const res = await exports.default.fetch(
			'https://id.flyindycenter.com/login/callback?code=c&state=mismatch',
			{ redirect: 'manual', headers: { Cookie: '__Host-oauth_state=different' } }
		);
		expect(res.status).toBe(400);
		const body = (await res.json()) as { error: { code: string } };
		expect(body.error.code).toBe('invalid_state');
	});

	it('400s with invalid_state when the return cookie is missing or malformed', async () => {
		const fetchSpy = vi.spyOn(globalThis, 'fetch');
		for (const cookie of [
			'__Host-oauth_state=state_xyz',
			'__Host-oauth_state=state_xyz; __Host-oauth_return=https://charts.flyindycenter.com/',
			`__Host-oauth_state=state_xyz; ${returnCookie('https://evil.com/')}`
		]) {
			const res = await callback(cookie);
			expect(res.status).toBe(400);
			const body = (await res.json()) as { error: { code: string } };
			expect(body.error.code).toBe('invalid_state');
			expect(
				res.headers.getSetCookie().find((c) => c.startsWith('__Host-identity_session='))
			).toBeUndefined();
		}
		// Rejected before talking to VATSIM.
		expect(fetchSpy).not.toHaveBeenCalled();

		const db = makeDb(env.DB);
		expect(await db.select().from(sessions).all()).toHaveLength(0);
		expect(await db.select().from(authorizationCodes).all()).toHaveLength(0);
	});

	it('rejects a disabled user with access_denied and issues nothing', async () => {
		// Pre-create the user as disabled — upsertFromVatsim does not re-enable.
		const db = makeDb(env.DB);
		const { id } = await upsertFromVatsim(db, {
			cid: '999',
			personal: { name_first: 'Test', name_last: 'User', email: 'test@example.com' }
		});
		await setUserActive(db, id, false, { reason: 'banned' });

		mockVatsim();
		const res = await callback(`__Host-oauth_state=state_xyz; ${returnCookie(REDIRECT)}`);
		expect(res.status).toBe(403);
		const body = (await res.json()) as { error: { code: string } };
		expect(body.error.code).toBe('access_denied');

		expect(
			res.headers.getSetCookie().find((c) => c.startsWith('__Host-identity_session='))
		).toBeUndefined();

		// vatsim_data archive is still refreshed (upsert ran before the gate)
		const u = await db.select().from(users).where(eq(users.cid, '999')).get();
		expect(u!.isActive).toBe(false);

		expect(await db.select().from(sessions).all()).toHaveLength(0);
		expect(await db.select().from(authorizationCodes).all()).toHaveLength(0);
	});

	it('502s with oauth_exchange_failed when the token exchange fails', async () => {
		vi.spyOn(globalThis, 'fetch').mockImplementationOnce(
			async () => new Response('oops', { status: 500 })
		);

		const res = await callback(`__Host-oauth_state=state_xyz; ${returnCookie(REDIRECT)}`);
		expect(res.status).toBe(502);
		const body = (await res.json()) as { error: { code: string } };
		expect(body.error.code).toBe('oauth_exchange_failed');

		expect(
			res.headers.getSetCookie().find((c) => c.startsWith('__Host-identity_session='))
		).toBeUndefined();

		const db = makeDb(env.DB);
		expect(await db.select().from(sessions).all()).toHaveLength(0);
		expect(await db.select().from(users).all()).toHaveLength(0);
		expect(await db.select().from(authorizationCodes).all()).toHaveLength(0);
	});
});
