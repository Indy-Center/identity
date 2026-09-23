import { env, exports } from 'cloudflare:workers';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { makeDb } from '../../src/db';
import { authorizationCodes, sessions, userRoles, users } from '../../src/schema';
import { upsertFromVatsim } from '../../src/users/domain';
import { createSession, validateSession } from '../../src/sessions/domain';
import { createAuthorizationCode } from '../../src/authorization-codes/domain';
import { __resetCacheForTests } from '../../src/online-controllers/domain';
import { __resetCacheForTests as __resetFlightPlansForTests } from '../../src/flight-plans/domain';
import { createIdentityClient, IdentityError, sessionCookieOptions } from '../../src/client';
import { makeVatsimProfile } from '../helpers/fixtures';

// The client under test talks to the in-process worker: the same fetch
// handler that serves https://auth.flyindycenter.com in production.
function makeClient() {
	return createIdentityClient({
		baseUrl: 'https://auth.flyindycenter.com',
		fetch: async (input, init) => exports.default.fetch(new Request(input, init))
	});
}

beforeEach(async () => {
	const db = makeDb(env.DB);
	await db.delete(authorizationCodes);
	await db.delete(userRoles);
	await db.delete(sessions);
	await db.delete(users);
	// No live feeds in tests: both lookups 404 and degrade to null.
	vi.spyOn(globalThis, 'fetch').mockImplementation(
		async () => new Response('not found', { status: 404 })
	);
});

afterEach(() => {
	__resetCacheForTests();
	__resetFlightPlansForTests();
	vi.restoreAllMocks();
});

async function seedUser(cid: string): Promise<string> {
	const db = makeDb(env.DB);
	const { id } = await upsertFromVatsim(db, makeVatsimProfile({ cid }));
	return id;
}

async function seedSession(cid: string): Promise<string> {
	const { token } = await createSession(makeDb(env.DB), await seedUser(cid));
	return token;
}

async function seedCode(cid: string, redirectUri: string): Promise<string> {
	const { code } = await createAuthorizationCode(makeDb(env.DB), await seedUser(cid), redirectUri);
	return code;
}

async function caught(p: Promise<unknown>): Promise<unknown> {
	return p.then(
		() => {
			throw new Error('expected a rejection');
		},
		(e: unknown) => e
	);
}

describe('IdentityClient against the worker', () => {
	it('returns the session context with a real Date', async () => {
		const token = await seedSession('21');
		const ctx = await makeClient().getSessionContext(token);
		expect(ctx?.user.cid).toBe('21');
		expect(ctx?.sessionExpiresAt).toBeInstanceOf(Date);
		expect(ctx?.activeSession).toBeNull();
		expect(ctx?.activeFlightPlan).toBeNull();
		// userinfo's extra claims do not leak into the parsed context
		expect(ctx).not.toHaveProperty('sub');
	});

	it('returns null for a bad token', async () => {
		expect(await makeClient().getSessionContext('nope')).toBeNull();
	});

	it('logs out', async () => {
		const token = await seedSession('22');
		const client = makeClient();
		await client.logout(token);
		expect(await client.getSessionContext(token)).toBeNull();
	});

	it('exchanges a code once and throws invalid_code on reuse', async () => {
		const redirectUri = 'http://localhost:5173/';
		const code = await seedCode('23', redirectUri);
		const client = makeClient();

		const result = await client.exchangeCode(code, redirectUri);
		expect(result.expiresAt).toBeInstanceOf(Date);
		expect(result.expiresAt.getTime()).toBeGreaterThan(Date.now());
		expect(result.session.user.cid).toBe('23');
		expect(result.session.sessionExpiresAt).toBeInstanceOf(Date);
		expect((await client.getSessionContext(result.token))?.user.cid).toBe('23');

		const err = await caught(client.exchangeCode(code, redirectUri));
		expect(err).toBeInstanceOf(IdentityError);
		expect((err as IdentityError).code).toBe('invalid_code');
		expect((err as IdentityError).status).toBe(400);
	});

	it('throws invalid_code for a mismatched redirect URI', async () => {
		const code = await seedCode('24', 'http://localhost:5173/');
		const err = await caught(makeClient().exchangeCode(code, 'http://localhost:5173/other'));
		expect(err).toBeInstanceOf(IdentityError);
		expect((err as IdentityError).code).toBe('invalid_code');
	});

	it('completeLogin returns null when the URL has no code', async () => {
		expect(await makeClient().completeLogin('http://localhost:5173/kind?tab=1')).toBeNull();
	});

	it('completeLogin exchanges the code against the stripped URL', async () => {
		// loginUrl sent this as redirect_uri; identity bound the code to it.
		const code = await seedCode('25', 'http://localhost:5173/kind?tab=1');
		const login = await makeClient().completeLogin(
			`http://localhost:5173/kind?tab=1&code=${code}&state=ignored`
		);
		expect(login).not.toBeNull();
		expect(login!.redirectTo).toBe('http://localhost:5173/kind?tab=1');
		expect(login!.session.user.cid).toBe('25');
		expect(login!.expiresAt).toBeInstanceOf(Date);
		expect((await validateSession(makeDb(env.DB), login!.token))?.expiresAt).toBeGreaterThan(
			Date.now()
		);
	});

	// A path starting with // or \\ would make `pathname + search` a
	// protocol-relative URL that a server redirect follows off-site.
	it.each([
		['//evil.com/x', 'https://charts.flyindycenter.com//evil.com/x'],
		['\\\\evil.com', 'https://charts.flyindycenter.com//evil.com']
	])('completeLogin keeps redirectTo on the consumer origin for %s', async (path, bound) => {
		const code = await seedCode('26', bound);
		const login = await makeClient().completeLogin(
			`https://charts.flyindycenter.com${path}?code=${code}`
		);
		expect(login!.redirectTo.startsWith('https://charts.flyindycenter.com/')).toBe(true);
		expect(login!.redirectTo.startsWith('//')).toBe(false);
		expect(new URL(login!.redirectTo).origin).toBe('https://charts.flyindycenter.com');
	});

	it('round-trips loginUrl through /oauth/authorize and completeLogin', async () => {
		const token = await seedSession('27');
		const identity = makeClient();
		const authorize = await exports.default.fetch(
			new Request(identity.loginUrl('https://charts.flyindycenter.com/kind?tab=1'), {
				headers: { Cookie: `__Host-identity_session=${token}` },
				redirect: 'manual'
			})
		);
		const location = authorize.headers.get('Location');
		expect(location).not.toBeNull();
		const login = await identity.completeLogin(location!);
		expect(login!.session.user.cid).toBe('27');
		expect(login!.redirectTo).toBe('https://charts.flyindycenter.com/kind?tab=1');
	});
});

describe('IdentityClient request details', () => {
	function recording(response: () => Response) {
		const seen: Request[] = [];
		const client = createIdentityClient({
			baseUrl: 'https://auth.flyindycenter.com',
			fetch: async (input, init) => {
				seen.push(new Request(input, init));
				return response();
			}
		});
		return { client, seen };
	}

	it('sends the token as a bearer header to /oauth/userinfo', async () => {
		const { client, seen } = recording(
			() =>
				new Response(JSON.stringify({ error: 'invalid_token' }), {
					status: 401,
					headers: { 'content-type': 'application/json' }
				})
		);
		expect(await client.getSessionContext('abc')).toBeNull();
		expect(seen[0]!.url).toBe('https://auth.flyindycenter.com/oauth/userinfo');
		expect(seen[0]!.headers.get('Authorization')).toBe('Bearer abc');
	});

	it('maps a 500 error envelope to IdentityError internal', async () => {
		const { client } = recording(
			() =>
				new Response(JSON.stringify({ error: { code: 'internal', message: 'boom' } }), {
					status: 500,
					headers: { 'content-type': 'application/json' }
				})
		);
		const err = await caught(client.getSessionContext('abc'));
		expect(err).toBeInstanceOf(IdentityError);
		expect((err as IdentityError).code).toBe('internal');
		expect((err as IdentityError).status).toBe(500);
		expect((err as IdentityError).message).toBe('boom');
	});

	it('posts a form to /oauth/token with the default client_id', async () => {
		const { client, seen } = recording(
			() =>
				new Response(JSON.stringify({ error: 'invalid_grant', error_description: 'nope' }), {
					status: 400,
					headers: { 'content-type': 'application/json' }
				})
		);
		const err = await caught(client.exchangeCode('c1', 'http://localhost:5173/'));
		expect((err as IdentityError).code).toBe('invalid_code');
		expect(seen[0]!.method).toBe('POST');
		expect(seen[0]!.url).toBe('https://auth.flyindycenter.com/oauth/token');
		expect(seen[0]!.headers.get('Content-Type')).toBe('application/x-www-form-urlencoded');
		expect(Object.fromEntries(await seen[0]!.formData())).toEqual({
			grant_type: 'authorization_code',
			code: 'c1',
			redirect_uri: 'http://localhost:5173/',
			client_id: 'indy-center-app'
		});
	});

	function json(body: unknown, status: number) {
		return () =>
			new Response(JSON.stringify(body), {
				status,
				headers: { 'content-type': 'application/json' }
			});
	}

	it('maps a malformed 2xx body to IdentityError internal', async () => {
		const { client } = recording(json({ nope: true }, 200));
		const err = await caught(client.getSessionContext('abc'));
		expect(err).toBeInstanceOf(IdentityError);
		expect((err as IdentityError).code).toBe('internal');
		expect((err as IdentityError).status).toBe(200);
	});

	it('maps a non-JSON 2xx body to IdentityError internal', async () => {
		const { client } = recording(() => new Response('<html>', { status: 200 }));
		const err = await caught(client.exchangeCode('c1', 'http://localhost:5173/'));
		expect(err).toBeInstanceOf(IdentityError);
		expect((err as IdentityError).code).toBe('internal');
	});

	it('maps an unknown envelope code to internal', async () => {
		const { client } = recording(json({ error: { code: 'made_up', message: 'huh' } }, 418));
		const err = await caught(client.getSessionContext('abc'));
		expect(err).toBeInstanceOf(IdentityError);
		expect((err as IdentityError).code).toBe('internal');
		expect((err as IdentityError).status).toBe(418);
	});
});

describe('IdentityClient URL builders and cookie helper', () => {
	const client = createIdentityClient();

	it('builds a standard authorize URL', () => {
		expect(client.loginUrl('http://localhost:5173/kind')).toBe(
			'https://auth.flyindycenter.com/oauth/authorize?response_type=code&client_id=indy-center-app&redirect_uri=http%3A%2F%2Flocalhost%3A5173%2Fkind'
		);
	});

	it('strips code, state and the fragment from the redirect URI it sends', () => {
		const url = new URL(
			client.loginUrl('https://charts.flyindycenter.com/kind?a=1&code=old&state=s#top')
		);
		expect(url.searchParams.get('redirect_uri')).toBe('https://charts.flyindycenter.com/kind?a=1');
	});

	it('canonicalizes host case, default port and spaces in the redirect URI', () => {
		const url = new URL(client.loginUrl('https://CHARTS.flyindycenter.com:443/a b?q=a+b#frag'));
		expect(url.searchParams.get('redirect_uri')).toBe(
			'https://charts.flyindycenter.com/a%20b?q=a+b'
		);
	});

	it('honors publicUrl and clientId', () => {
		const custom = createIdentityClient({ publicUrl: 'http://localhost:8787', clientId: 'x' });
		const url = new URL(custom.loginUrl('http://localhost:5173/'));
		expect(url.origin).toBe('http://localhost:8787');
		expect(url.searchParams.get('client_id')).toBe('x');
	});

	it('defaults publicUrl to baseUrl, so a local identity gets local links', () => {
		const local = createIdentityClient({ baseUrl: 'http://localhost:8787' });
		expect(new URL(local.loginUrl('http://localhost:5173/')).origin).toBe('http://localhost:8787');
		expect(new URL(local.logoutUrl('http://localhost:5173/')).origin).toBe('http://localhost:8787');
	});

	it('builds the global logout URL', () => {
		expect(client.logoutUrl('https://charts.flyindycenter.com/')).toBe(
			'https://auth.flyindycenter.com/logout?return_url=https%3A%2F%2Fcharts.flyindycenter.com%2F'
		);
	});

	it('returns the documented cookie attributes', () => {
		const expiresAt = new Date('2026-10-23T00:00:00Z');
		expect(sessionCookieOptions({ expiresAt, secure: true })).toEqual({
			path: '/',
			httpOnly: true,
			sameSite: 'lax',
			secure: true,
			expires: expiresAt
		});
	});
});
