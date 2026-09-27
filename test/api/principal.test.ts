import { env } from 'cloudflare:workers';
import { Hono } from 'hono';
import { beforeEach, describe, expect, it } from 'vitest';
import { makeDb } from '../../src/db';
import { clients, clientTokens, sessions, userRoles, users } from '../../src/schema';
import { errorHandler } from '../../src/error-handler';
import { principal, requireScope, roleSource, type ApiEnv } from '../../src/api/principal';
import { issueClientToken } from '../../src/clients/domain';
import { createSession } from '../../src/sessions/domain';
import { upsertFromVatsim } from '../../src/users/domain';
import { makeVatsimProfile, seedClient } from '../helpers/fixtures';
import { eq } from 'drizzle-orm';

const db = () => makeDb(env.DB);

const app = new Hono<ApiEnv>();
app.onError(errorHandler);
app.use('*', principal);
app.get('/whoami', (c) => c.json({ ...c.var.principal, source: roleSource(c.var.principal) }));
app.get('/write', requireScope('users:write'), (c) => c.json({ ok: true }));

const call = (path: string, token?: string) =>
	app.request(path, { headers: token ? { Authorization: `Bearer ${token}` } : {} }, env);

const callWith = (headers: Record<string, string>) => app.request('/whoami', { headers }, env);

beforeEach(async () => {
	for (const t of [clientTokens, clients, userRoles, sessions, users]) {
		await db().delete(t);
	}
});

describe('principal', () => {
	it('resolves a client token', async () => {
		await seedClient(db(), 'bot', { scopes: ['users:read'] });
		const { token } = await issueClientToken(db(), 'bot', ['users:read']);
		expect(await (await call('/whoami', token)).json()).toEqual({
			kind: 'client',
			id: 'bot',
			scopes: ['users:read'],
			source: 'bot'
		});
	});

	it('resolves a user session with roles', async () => {
		await upsertFromVatsim(db(), makeVatsimProfile({ cid: '9' }));
		await db().insert(userRoles).values({ cid: '9', role: 'a:b', source: 'x', grantedAt: 1 });
		const { token } = await createSession(db(), '9');
		expect(await (await call('/whoami', token)).json()).toEqual({
			kind: 'user',
			cid: '9',
			roles: ['a:b'],
			source: 'user:9'
		});
	});

	it('accepts a lowercase bearer scheme', async () => {
		await upsertFromVatsim(db(), makeVatsimProfile({ cid: '9' }));
		const { token } = await createSession(db(), '9');
		expect((await callWith({ Authorization: `bearer ${token}` })).status).toBe(200);
	});

	it('rejects missing, unknown, and raw-secret bearers with 401', async () => {
		const secret = await seedClient(db(), 'bot', { scopes: ['users:read'] });
		for (const token of [undefined, 'nope', secret]) {
			const res = await call('/whoami', token);
			expect(res.status).toBe(401);
			expect(((await res.json()) as { error: { code: string } }).error.code).toBe(
				'unauthenticated'
			);
		}
	});

	it('sends an RFC 6750 challenge: bare without a token, invalid_token with a bad one', async () => {
		const missing = await call('/whoami');
		expect(missing.headers.get('WWW-Authenticate')).toBe('Bearer');
		const bad = await call('/whoami', 'nope');
		expect(bad.headers.get('WWW-Authenticate')).toBe('Bearer error="invalid_token"');
	});

	it('treats an empty bearer, a non-bearer scheme, or a cookie as no token', async () => {
		await upsertFromVatsim(db(), makeVatsimProfile({ cid: '9' }));
		const { token } = await createSession(db(), '9');
		for (const headers of <Record<string, string>[]>[
			{ Authorization: 'Bearer ' },
			{ Authorization: `Basic ${token}` },
			{ Cookie: `identity_session=${token}` }
		]) {
			const res = await callWith(headers);
			expect(res.status).toBe(401);
			expect(res.headers.get('WWW-Authenticate')).toBe('Bearer');
		}
	});

	it('rejects an expired client token', async () => {
		await seedClient(db(), 'bot', { scopes: ['users:read'] });
		const { token } = await issueClientToken(db(), 'bot', ['users:read']);
		await db()
			.update(clientTokens)
			.set({ expiresAt: Date.now() - 1 });
		expect((await call('/whoami', token)).status).toBe(401);
	});

	it('rejects an expired session', async () => {
		await upsertFromVatsim(db(), makeVatsimProfile({ cid: '9' }));
		const { token } = await createSession(db(), '9');
		await db()
			.update(sessions)
			.set({ expiresAt: Date.now() - 1 })
			.where(eq(sessions.cid, '9'));
		expect((await call('/whoami', token)).status).toBe(401);
	});

	it("rejects a disabled user's session", async () => {
		await upsertFromVatsim(db(), makeVatsimProfile({ cid: '9' }));
		const { token } = await createSession(db(), '9');
		// Bypass setUserActive's session purge to prove the lookup itself checks `active`.
		await db().update(users).set({ active: false }).where(eq(users.cid, '9'));
		expect((await call('/whoami', token)).status).toBe(401);
	});
});

describe('requireScope', () => {
	it('allows write clients and global:admin users; forbids the rest', async () => {
		await seedClient(db(), 'w', { scopes: ['users:write'] });
		await seedClient(db(), 'r', { scopes: ['users:read'] });
		const write = (await issueClientToken(db(), 'w', ['users:write'])).token;
		const read = (await issueClientToken(db(), 'r', ['users:read'])).token;
		await upsertFromVatsim(db(), makeVatsimProfile({ cid: '1' }));
		await upsertFromVatsim(db(), makeVatsimProfile({ cid: '2' }));
		await db()
			.insert(userRoles)
			.values({ cid: '1', role: 'global:admin', source: 'cli', grantedAt: 1 });
		const admin = (await createSession(db(), '1')).token;
		const plain = (await createSession(db(), '2')).token;

		expect((await call('/write', write)).status).toBe(200);
		expect((await call('/write', admin)).status).toBe(200);
		for (const token of [read, plain]) {
			const res = await call('/write', token);
			expect(res.status).toBe(403);
			expect(res.headers.get('WWW-Authenticate')).toBe(
				'Bearer error="insufficient_scope", scope="users:write"'
			);
			expect(((await res.json()) as { error: { code: string } }).error.code).toBe(
				'insufficient_scope'
			);
		}
	});
});
