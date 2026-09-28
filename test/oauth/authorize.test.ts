import { env, exports } from 'cloudflare:workers';
import { beforeEach, describe, expect, it } from 'vitest';
import { makeDb } from '../../src/db';
import { authorizationCodes, clients, sessions, users } from '../../src/schema';
import { setUserActive, upsertFromVatsim } from '../../src/users/domain';
import { createSession } from '../../src/sessions/domain';
import { makeVatsimProfile, seedClient } from '../helpers/fixtures';

const REDIRECT = 'https://charts.flyindycenter.com/kind?tab=charts';

function authorizeUrl(params: Record<string, string>): string {
	return `https://id.flyindycenter.com/oauth/authorize?${new URLSearchParams(params)}`;
}

const VALID = { response_type: 'code', client_id: 'charts', redirect_uri: REDIRECT };

beforeEach(async () => {
	const db = makeDb(env.DB);
	await db.delete(authorizationCodes);
	await db.delete(sessions);
	await db.delete(users);
	await db.delete(clients);
});

async function expectErrorCode(res: Response, code: string) {
	expect(res.status).toBe(400);
	expect(res.headers.get('Location')).toBeNull();
	const body = (await res.json()) as { error: { code: string } };
	expect(body.error.code).toBe(code);
}

describe('GET /oauth/authorize — validation', () => {
	it('400s without redirecting for a disallowed redirect_uri', async () => {
		const res = await exports.default.fetch(
			authorizeUrl({ ...VALID, redirect_uri: 'https://evil.com/' }),
			{ redirect: 'manual' }
		);
		await expectErrorCode(res, 'invalid_return_url');
	});

	it('400s without redirecting for a missing redirect_uri', async () => {
		const res = await exports.default.fetch(
			authorizeUrl({ response_type: 'code', client_id: 'charts' }),
			{ redirect: 'manual' }
		);
		await expectErrorCode(res, 'invalid_return_url');
	});

	it('400s without redirecting for a missing client_id', async () => {
		const res = await exports.default.fetch(
			authorizeUrl({ response_type: 'code', redirect_uri: REDIRECT }),
			{ redirect: 'manual' }
		);
		await expectErrorCode(res, 'validation_failed');
	});

	it('400s without redirecting for response_type=token', async () => {
		const res = await exports.default.fetch(authorizeUrl({ ...VALID, response_type: 'token' }), {
			redirect: 'manual'
		});
		await expectErrorCode(res, 'validation_failed');
	});

	it('400s without redirecting for an over-long state', async () => {
		const res = await exports.default.fetch(authorizeUrl({ ...VALID, state: 'x'.repeat(3000) }), {
			redirect: 'manual'
		});
		await expectErrorCode(res, 'validation_failed');
	});
});

describe('GET /oauth/authorize — no identity session', () => {
	it('redirects to VATSIM with the state and return cookies set', async () => {
		const res = await exports.default.fetch(authorizeUrl({ ...VALID, state: 'xyz' }), {
			redirect: 'manual'
		});
		expect(res.status).toBe(302);

		const location = new URL(res.headers.get('Location')!);
		expect(location.origin + location.pathname).toBe('https://auth.vatsim.net/oauth/authorize');
		expect(location.searchParams.get('client_id')).toBe('test_client_id');
		expect(location.searchParams.get('redirect_uri')).toBe(
			'https://id.flyindycenter.com/login/callback'
		);
		const vatsimState = location.searchParams.get('state');
		expect(vatsimState).toBeTruthy();

		const setCookies = res.headers.getSetCookie();
		const stateCookie = setCookies.find((c) => c.startsWith('__Host-oauth_state='));
		expect(stateCookie).toContain(`__Host-oauth_state=${vatsimState}`);
		expect(stateCookie).toContain('HttpOnly');
		expect(stateCookie).toContain('SameSite=Lax');

		const returnCookie = setCookies.find((c) => c.startsWith('__Host-oauth_return='));
		expect(returnCookie).toBeDefined();
		const value = decodeURIComponent(
			returnCookie!.split(';')[0]!.slice('__Host-oauth_return='.length)
		);
		expect(JSON.parse(value)).toEqual({ redirectUri: REDIRECT, clientId: 'charts', state: 'xyz' });
	});

	it('accepts a loopback redirect_uri', async () => {
		const res = await exports.default.fetch(
			authorizeUrl({ ...VALID, redirect_uri: 'http://localhost:5173/' }),
			{ redirect: 'manual' }
		);
		expect(res.status).toBe(302);
		expect(new URL(res.headers.get('Location')!).origin).toBe('https://auth.vatsim.net');
	});
});

describe('GET /oauth/authorize — with an identity session (SSO)', () => {
	it('redirects straight back with a code and the echoed state', async () => {
		const db = makeDb(env.DB);
		const { cid } = await upsertFromVatsim(db, makeVatsimProfile({ cid: '1' }));
		const { token } = await createSession(db, cid);

		const res = await exports.default.fetch(authorizeUrl({ ...VALID, state: 'xyz' }), {
			redirect: 'manual',
			headers: { Cookie: `__Host-identity_session=${token}` }
		});
		expect(res.status).toBe(302);

		const location = new URL(res.headers.get('Location')!);
		expect(location.origin + location.pathname).toBe('https://charts.flyindycenter.com/kind');
		expect(location.searchParams.get('tab')).toBe('charts');
		expect(location.searchParams.get('code')).toMatch(/^[a-z2-7]{32}$/);
		expect(location.searchParams.get('state')).toBe('xyz');

		const setCookies = res.headers.getSetCookie();
		expect(setCookies.find((c) => c.startsWith('__Host-oauth_state='))).toBeUndefined();

		const codes = await db.select().from(authorizationCodes).all();
		expect(codes).toHaveLength(1);
		expect(codes[0]!.cid).toBe(cid);
		expect(codes[0]!.redirectUri).toBe(REDIRECT);
	});

	it('clears the legacy fic_session cookie', async () => {
		const db = makeDb(env.DB);
		const { cid } = await upsertFromVatsim(db, makeVatsimProfile({ cid: '5' }));
		const { token } = await createSession(db, cid);

		const res = await exports.default.fetch(authorizeUrl(VALID), {
			redirect: 'manual',
			headers: { Cookie: `__Host-identity_session=${token}` }
		});
		expect(res.status).toBe(302);

		const legacyCookie = res.headers.getSetCookie().find((c) => c.startsWith('fic_session=;'));
		expect(legacyCookie).toContain('Domain=.flyindycenter.com');
		expect(legacyCookie).toContain('Max-Age=0');
	});

	it('400s and mints no code when the redirect_uri is disallowed, even with a valid session', async () => {
		const db = makeDb(env.DB);
		const { cid } = await upsertFromVatsim(db, makeVatsimProfile({ cid: '6' }));
		const { token } = await createSession(db, cid);

		const res = await exports.default.fetch(
			authorizeUrl({ ...VALID, redirect_uri: 'https://evil.com/' }),
			{ redirect: 'manual', headers: { Cookie: `__Host-identity_session=${token}` } }
		);
		expect(res.status).toBe(400);
		expect(res.headers.get('Location')).toBeNull();
		const body = (await res.json()) as { error: { code: string } };
		expect(body.error.code).toBe('invalid_return_url');

		expect(await db.select().from(authorizationCodes).all()).toHaveLength(0);
	});

	it('falls through to VATSIM instead of minting a code for a disabled user', async () => {
		const db = makeDb(env.DB);
		const { cid } = await upsertFromVatsim(db, makeVatsimProfile({ cid: '7' }));
		const { token } = await createSession(db, cid);
		await setUserActive(db, cid, false, { reason: 'test' });

		const res = await exports.default.fetch(authorizeUrl(VALID), {
			redirect: 'manual',
			headers: { Cookie: `__Host-identity_session=${token}` }
		});
		expect(res.status).toBe(302);
		expect(new URL(res.headers.get('Location')!).origin).toBe('https://auth.vatsim.net');

		expect(await db.select().from(authorizationCodes).all()).toHaveLength(0);
	});

	it('omits state when the client sent none', async () => {
		const db = makeDb(env.DB);
		const { cid } = await upsertFromVatsim(db, makeVatsimProfile({ cid: '2' }));
		const { token } = await createSession(db, cid);

		const res = await exports.default.fetch(authorizeUrl(VALID), {
			redirect: 'manual',
			headers: { Cookie: `__Host-identity_session=${token}` }
		});
		expect(new URL(res.headers.get('Location')!).searchParams.has('state')).toBe(false);
	});

	it('clears an invalid identity cookie and falls through to VATSIM', async () => {
		const res = await exports.default.fetch(authorizeUrl(VALID), {
			redirect: 'manual',
			headers: { Cookie: '__Host-identity_session=not-a-real-token' }
		});
		expect(res.status).toBe(302);
		expect(new URL(res.headers.get('Location')!).origin).toBe('https://auth.vatsim.net');

		const cleared = res.headers
			.getSetCookie()
			.find((c) => c.startsWith('__Host-identity_session='));
		expect(cleared).toMatch(/^__Host-identity_session=;/);
		expect(cleared).toContain('Max-Age=0');
	});
});

describe('GET /oauth/authorize — registered clients', () => {
	const MOODLE_REDIRECT = 'https://moodle.example.org/admin/oauth2callback.php';
	const authorize = (clientId: string, redirectUri: string) =>
		exports.default.fetch(
			authorizeUrl({ response_type: 'code', client_id: clientId, redirect_uri: redirectUri }),
			{ redirect: 'manual' }
		);

	it('accepts an exactly registered redirect_uri even off our domain', async () => {
		await seedClient(makeDb(env.DB), 'moodle', { redirectUris: [MOODLE_REDIRECT] });
		const res = await authorize('moodle', MOODLE_REDIRECT);
		expect(res.status).toBe(302); // on to VATSIM
		expect(res.headers.get('Location')).not.toContain('moodle.example.org');
	});

	it('rejects any other redirect_uri, even an allowlisted one', async () => {
		await seedClient(makeDb(env.DB), 'moodle', { redirectUris: [MOODLE_REDIRECT] });
		await expectErrorCode(
			await authorize('moodle', `${MOODLE_REDIRECT}?x=1`),
			'invalid_return_url'
		);
		await expectErrorCode(
			await authorize('moodle', 'https://charts.flyindycenter.com/'),
			'invalid_return_url'
		);
	});

	it('rejects a service client that has no redirect_uris', async () => {
		await seedClient(makeDb(env.DB), 'bot', { scopes: ['users:read'] });
		await expectErrorCode(
			await authorize('bot', 'https://charts.flyindycenter.com/'),
			'invalid_return_url'
		);
	});

	it('rejects an over-long client_id before looking it up', async () => {
		await expectErrorCode(await authorize('x'.repeat(2049), MOODLE_REDIRECT), 'validation_failed');
	});

	it('still rejects an off-domain redirect_uri for an unregistered client', async () => {
		await expectErrorCode(await authorize('moodle', MOODLE_REDIRECT), 'invalid_return_url');
	});
});
