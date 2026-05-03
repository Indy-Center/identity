import { exports, env } from 'cloudflare:workers';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { makeDb } from '../../src/db';
import { users, sessions } from '../../src/schema';
import { upsertFromVatsim, setUserActive } from '../../src/users/domain';

beforeEach(async () => {
	const db = makeDb(env.DB);
	await db.delete(sessions);
	await db.delete(users);
});

afterEach(() => {
	vi.restoreAllMocks();
});

function mockVatsim() {
	const mockFetch = vi
		.fn()
		.mockImplementationOnce((_url: string, _init?: RequestInit) => {
			// token exchange POST /oauth/token
			return Promise.resolve(
				new Response(
					JSON.stringify({ access_token: 'access_xyz', token_type: 'Bearer', expires_in: 3600 }),
					{ status: 200, headers: { 'content-type': 'application/json' } }
				)
			);
		})
		.mockImplementationOnce((_url: string, _init?: RequestInit) => {
			// profile fetch GET /api/user
			return Promise.resolve(
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
		});
	globalThis.fetch = mockFetch as unknown as typeof fetch;
	return mockFetch;
}

describe('GET /login/callback', () => {
	it('exchanges code, upserts user, mints session, sets cookie, redirects', async () => {
		mockVatsim();
		const res = await exports.default.fetch(
			'https://auth.flyindycenter.com/login/callback?code=auth_code&state=state_xyz',
			{
				redirect: 'manual',
				headers: {
					Cookie: '__Host-oauth_state=state_xyz; __Host-oauth_return=https://app.flyindycenter.com/'
				}
			}
		);
		expect(res.status).toBe(302);

		const setCookies = res.headers.getSetCookie();
		const session = setCookies.find((c) => c.startsWith('fic_session='));
		expect(session).toBeDefined();
		expect(session).toContain('Domain=.flyindycenter.com');

		const stateCleared = setCookies.find((c) => c.startsWith('__Host-oauth_state='));
		expect(stateCleared).toContain('Max-Age=0');

		const db = makeDb(env.DB);
		const u = await db.select().from(users).where(eq(users.cid, '999')).get();
		expect(u).toBeTruthy();
		const allSessions = await db.select().from(sessions).all();
		expect(allSessions).toHaveLength(1);
	});

	it('honors __Host-oauth_return cookie when redirecting', async () => {
		mockVatsim();
		const res = await exports.default.fetch(
			'https://auth.flyindycenter.com/login/callback?code=auth_code&state=state_xyz',
			{
				redirect: 'manual',
				headers: {
					Cookie:
						'__Host-oauth_state=state_xyz; __Host-oauth_return=https://app.flyindycenter.com/x'
				}
			}
		);
		expect(res.status).toBe(302);
		expect(res.headers.get('Location')).toBe('https://app.flyindycenter.com/x');
	});

	it('400s with invalid_state when state cookie missing', async () => {
		const res = await exports.default.fetch(
			'https://auth.flyindycenter.com/login/callback?code=c&state=s',
			{
				redirect: 'manual'
			}
		);
		expect(res.status).toBe(400);
		const body = (await res.json()) as { error: { code: string } };
		expect(body.error.code).toBe('invalid_state');
	});

	it('rejects a disabled user with access_denied', async () => {
		// Pre-create the user as disabled — upsertFromVatsim does not re-enable.
		const db = makeDb(env.DB);
		const { id } = await upsertFromVatsim(db, {
			cid: '999',
			personal: { name_first: 'Test', name_last: 'User', email: 'test@example.com' }
		});
		await setUserActive(db, id, false, { reason: 'banned' });

		mockVatsim();
		const res = await exports.default.fetch(
			'https://auth.flyindycenter.com/login/callback?code=auth_code&state=state_xyz',
			{
				redirect: 'manual',
				headers: {
					Cookie: '__Host-oauth_state=state_xyz; __Host-oauth_return=https://app.flyindycenter.com/'
				}
			}
		);
		expect(res.status).toBe(403);
		const body = (await res.json()) as { error: { code: string } };
		expect(body.error.code).toBe('access_denied');

		// No fic_session cookie set
		const setCookies = res.headers.getSetCookie();
		const session = setCookies.find((c) => c.startsWith('fic_session='));
		expect(session).toBeUndefined();

		// vatsim_data archive is still refreshed (upsert ran before the gate)
		const u = await db.select().from(users).where(eq(users.cid, '999')).get();
		expect(u).toBeTruthy();
		expect(u!.isActive).toBe(false);

		// No new session created
		const allSessions = await db.select().from(sessions).all();
		expect(allSessions).toHaveLength(0);
	});

	it('400s with invalid_state when oauth_return cookie missing', async () => {
		mockVatsim();
		const res = await exports.default.fetch(
			'https://auth.flyindycenter.com/login/callback?code=auth_code&state=state_xyz',
			{
				redirect: 'manual',
				headers: { Cookie: '__Host-oauth_state=state_xyz' }
			}
		);
		expect(res.status).toBe(400);
		const body = (await res.json()) as { error: { code: string } };
		expect(body.error.code).toBe('invalid_state');

		// Failing the cookie check must not leak a session cookie or persist
		// a session row — the request should be a clean rejection.
		const setCookies = res.headers.getSetCookie();
		const session = setCookies.find((c) => c.startsWith('fic_session='));
		expect(session).toBeUndefined();

		const db = makeDb(env.DB);
		const allSessions = await db.select().from(sessions).all();
		expect(allSessions).toHaveLength(0);
	});

	it('400s when state mismatches', async () => {
		const res = await exports.default.fetch(
			'https://auth.flyindycenter.com/login/callback?code=c&state=mismatch',
			{
				redirect: 'manual',
				headers: { Cookie: '__Host-oauth_state=different' }
			}
		);
		expect(res.status).toBe(400);
		const body = (await res.json()) as { error: { code: string } };
		expect(body.error.code).toBe('invalid_state');
	});

	it('502s with oauth_exchange_failed when the token exchange fails', async () => {
		globalThis.fetch = vi
			.fn()
			.mockResolvedValueOnce(new Response('oops', { status: 500 })) as unknown as typeof fetch;

		const res = await exports.default.fetch(
			'https://auth.flyindycenter.com/login/callback?code=auth_code&state=state_xyz',
			{
				redirect: 'manual',
				headers: {
					Cookie: '__Host-oauth_state=state_xyz; __Host-oauth_return=https://app.flyindycenter.com/'
				}
			}
		);
		expect(res.status).toBe(502);
		const body = (await res.json()) as { error: { code: string } };
		expect(body.error.code).toBe('oauth_exchange_failed');

		const setCookies = res.headers.getSetCookie();
		const session = setCookies.find((c) => c.startsWith('fic_session='));
		expect(session).toBeUndefined();

		const db = makeDb(env.DB);
		expect(await db.select().from(sessions).all()).toHaveLength(0);
		expect(await db.select().from(users).all()).toHaveLength(0);
	});
});
