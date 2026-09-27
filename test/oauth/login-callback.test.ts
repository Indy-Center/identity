import { exports, env } from 'cloudflare:workers';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { makeDb } from '../../src/db';
import { authorizationCodes, clients, users, sessions } from '../../src/schema';
import { upsertFromVatsim, setUserActive } from '../../src/users/domain';
import { validateSession } from '../../src/sessions/domain';
import { seedClient } from '../helpers/fixtures';

const CALLBACK = 'https://id.flyindycenter.com/login/callback?code=auth_code&state=state_xyz';
const REDIRECT = 'https://charts.flyindycenter.com/kind';

beforeEach(async () => {
	const db = makeDb(env.DB);
	await db.delete(authorizationCodes);
	await db.delete(sessions);
	await db.delete(users);
	await db.delete(clients);
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
		expect((await validateSession(db, token))?.cid).toBe(user!.cid);

		const codes = await db.select().from(authorizationCodes).all();
		expect(codes).toHaveLength(1);
		expect(codes[0]!.cid).toBe(user!.cid);
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
		const { cid } = await upsertFromVatsim(db, {
			cid: '999',
			personal: { name_first: 'Test', name_last: 'User', email: 'test@example.com' }
		});
		await setUserActive(db, cid, false, { reason: 'banned' });

		mockVatsim();
		const res = await callback(`__Host-oauth_state=state_xyz; ${returnCookie(REDIRECT)}`);
		expect(res.status).toBe(403);
		const body = (await res.json()) as { error: { code: string } };
		expect(body.error.code).toBe('access_denied');

		expect(
			res.headers.getSetCookie().find((c) => c.startsWith('__Host-identity_session='))
		).toBeUndefined();

		// VATSIM columns are still refreshed (upsert ran before the gate)
		const u = await db.select().from(users).where(eq(users.cid, '999')).get();
		expect(u!.active).toBe(false);

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

describe('GET /login/callback — registered off-domain client', () => {
	const MOODLE_REDIRECT = 'https://moodle.example.org/admin/oauth2callback.php';

	// Start at /oauth/authorize and carry its cookies to the callback, as a
	// browser would after VATSIM sends it back.
	async function startLogin(): Promise<{ cookie: string; state: string }> {
		const res = await exports.default.fetch(
			`https://id.flyindycenter.com/oauth/authorize?${new URLSearchParams({
				response_type: 'code',
				client_id: 'moodle',
				redirect_uri: MOODLE_REDIRECT,
				state: 'moodle_state'
			})}`,
			{ redirect: 'manual' }
		);
		expect(res.status).toBe(302);
		const pairs = res.headers.getSetCookie().map((c) => c.split(';')[0]!);
		const state = pairs.find((p) => p.startsWith('__Host-oauth_state='))!.split('=')[1]!;
		return { cookie: pairs.join('; '), state };
	}

	function finishLogin(cookie: string, state: string): Promise<Response> {
		return exports.default.fetch(
			`https://id.flyindycenter.com/login/callback?code=auth_code&state=${state}`,
			{ redirect: 'manual', headers: { Cookie: cookie } }
		);
	}

	it('redirects to the registered URI with a code the client can redeem', async () => {
		const db = makeDb(env.DB);
		const secret = await seedClient(db, 'moodle', { redirectUris: [MOODLE_REDIRECT] });
		const { cookie, state } = await startLogin();
		mockVatsim();

		const res = await finishLogin(cookie, state);
		expect(res.status).toBe(302);
		const location = new URL(res.headers.get('Location')!);
		expect(location.origin + location.pathname).toBe(MOODLE_REDIRECT);
		expect(location.searchParams.get('state')).toBe('moodle_state');
		const code = location.searchParams.get('code')!;

		const token = await exports.default.fetch('https://id.flyindycenter.com/oauth/token', {
			method: 'POST',
			headers: {
				'Content-Type': 'application/x-www-form-urlencoded',
				Authorization: `Basic ${btoa(`moodle:${secret}`)}`
			},
			body: new URLSearchParams({
				grant_type: 'authorization_code',
				code,
				redirect_uri: MOODLE_REDIRECT
			}).toString()
		});
		expect(token.status).toBe(200);
		const body = (await token.json()) as { access_token: string };
		expect((await validateSession(db, body.access_token))?.cid).toBe('999');
	});

	it('400s if the client no longer lists the URI when the login finishes', async () => {
		const db = makeDb(env.DB);
		await seedClient(db, 'moodle', { redirectUris: [MOODLE_REDIRECT] });
		const { cookie, state } = await startLogin();
		await db
			.update(clients)
			.set({ redirectUris: ['https://moodle.example.org/other'] })
			.where(eq(clients.id, 'moodle'));
		const fetchSpy = vi.spyOn(globalThis, 'fetch');

		const res = await finishLogin(cookie, state);
		expect(res.status).toBe(400);
		expect(res.headers.get('Location')).toBeNull();
		expect(((await res.json()) as { error: { code: string } }).error.code).toBe('invalid_state');
		expect(fetchSpy).not.toHaveBeenCalled();
		expect(await db.select().from(authorizationCodes).all()).toHaveLength(0);
	});
});
