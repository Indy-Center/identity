import { env, exports } from 'cloudflare:workers';
import { beforeEach, describe, expect, it } from 'vitest';
import { makeDb } from '../../src/db';
import { clients, clientTokens, sessions, userRoles, users } from '../../src/schema';
import {
	authenticateClient,
	issueClientToken,
	listClients,
	validateClientToken
} from '../../src/clients/domain';
import { createSession } from '../../src/sessions/domain';
import { upsertFromVatsim } from '../../src/users/domain';
import { makeVatsimProfile, seedClient } from '../helpers/fixtures';

const BASE = 'https://id.flyindycenter.com/api';
const db = () => makeDb(env.DB);
let admin: string;

beforeEach(async () => {
	for (const t of [clientTokens, clients, userRoles, sessions, users]) {
		await db().delete(t);
	}
	await upsertFromVatsim(db(), makeVatsimProfile({ cid: '1' }));
	await upsertFromVatsim(db(), makeVatsimProfile({ cid: '2' }));
	await db()
		.insert(userRoles)
		.values({ cid: '1', role: 'global:admin', source: 'cli', grantedAt: 1 });
	await seedClient(db(), 'admin-tool', { scopes: ['clients:manage'] });
	admin = (await createSession(db(), '1', 'admin-tool')).token;
});

function api(method: string, path: string, token: string, body?: unknown) {
	return exports.default.fetch(`${BASE}${path}`, {
		method,
		headers: {
			Authorization: `Bearer ${token}`,
			...(body !== undefined ? { 'Content-Type': 'application/json' } : {})
		},
		body: body !== undefined ? JSON.stringify(body) : undefined
	});
}

const clientIds = async () => (await listClients(db())).map((c) => c.id);

type Secret = { client_id: string; client_secret: string };

describe('/api/clients', () => {
	it('registers a client whose secret works, and lists it without the secret', async () => {
		const res = await api('POST', '/clients', admin, {
			client_id: 'moodle',
			scopes: ['users:read'],
			redirect_uris: ['https://moodle.example.org/admin/oauth2callback.php']
		});
		expect(res.status).toBe(201);
		const created = (await res.json()) as Secret;
		expect(created.client_id).toBe('moodle');
		expect(created.client_secret).toMatch(/^moodle_[a-z2-7]{52}$/);
		expect(await authenticateClient(db(), 'moodle', created.client_secret)).not.toBeNull();

		const list = await api('GET', '/clients', admin);
		const body = await list.text();
		expect(body).not.toContain(created.client_secret);
		expect(JSON.parse(body)).toEqual([
			{
				client_id: 'admin-tool',
				scopes: ['clients:manage'],
				redirect_uris: [],
				created_at: expect.any(Number)
			},
			{
				client_id: 'moodle',
				scopes: ['users:read'],
				redirect_uris: ['https://moodle.example.org/admin/oauth2callback.php'],
				created_at: expect.any(Number)
			}
		]);
	});

	it('409 for an id already taken', async () => {
		await seedClient(db(), 'community', { scopes: ['users:read'] });
		const res = await api('POST', '/clients', admin, {
			client_id: 'community',
			scopes: ['users:read']
		});
		expect(res.status).toBe(409);
	});

	it('400 for a bad id, a reserved id, a bad redirect uri, or a client that can do nothing', async () => {
		for (const body of [
			{ client_id: 'Bad Id', scopes: ['users:read'] },
			{ client_id: 'cli', scopes: ['users:read'] },
			{ client_id: 'a', scopes: ['users:admin'] },
			{ client_id: 'a', redirect_uris: ['http://evil.example.org/cb'] },
			{ client_id: 'a', redirect_uris: ['https://a.example.org/cb#frag'] },
			{ client_id: 'a' },
			{ client_id: 'a', scopes: ['users:read'], secret: 'mine' }
		]) {
			const res = await api('POST', '/clients', admin, body);
			expect(res.status, JSON.stringify(body)).toBe(400);
		}
		expect(await clientIds()).toEqual(['admin-tool']);
	});

	it('rotate replaces the secret and drops outstanding tokens; 404 if unknown', async () => {
		const old = await seedClient(db(), 'bot', { scopes: ['users:read'] });
		const { token } = await issueClientToken(db(), 'bot', ['users:read']);
		const res = await api('POST', '/clients/bot/rotate', admin);
		expect(res.status).toBe(200);
		const rotated = (await res.json()) as Secret;
		expect(await authenticateClient(db(), 'bot', old)).toBeNull();
		expect(await authenticateClient(db(), 'bot', rotated.client_secret)).not.toBeNull();
		expect(await validateClientToken(db(), token)).toBeNull();
		expect((await api('POST', '/clients/nope/rotate', admin)).status).toBe(404);
	});

	it('update replaces scopes and redirect uris, keeps the secret, drops tokens on a scope change', async () => {
		const secret = await seedClient(db(), 'bot', { scopes: ['users:write'] });
		const { token } = await issueClientToken(db(), 'bot', ['users:write']);
		const res = await api('PATCH', '/clients/bot', admin, {
			scopes: ['users:read'],
			redirect_uris: ['https://bot.example.org/cb']
		});
		expect(res.status).toBe(200);
		expect(await res.json()).toEqual({
			client_id: 'bot',
			scopes: ['users:read'],
			redirect_uris: ['https://bot.example.org/cb'],
			created_at: expect.any(Number)
		});
		expect(await authenticateClient(db(), 'bot', secret)).not.toBeNull();
		expect(await validateClientToken(db(), token)).toBeNull();

		// redirect uris alone: scopes and tokens are untouched; [] clears the list
		const kept = await issueClientToken(db(), 'bot', ['users:read']);
		const cleared = await api('PATCH', '/clients/bot', admin, { redirect_uris: [] });
		expect(await cleared.json()).toMatchObject({ scopes: ['users:read'], redirect_uris: [] });
		expect(await validateClientToken(db(), kept.token)).not.toBeNull();

		expect((await api('PATCH', '/clients/bot', admin, {})).status).toBe(400);
		expect((await api('PATCH', '/clients/bot', admin, { scopes: ['nope'] })).status).toBe(400);
		expect((await api('PATCH', '/clients/nope', admin, { scopes: [] })).status).toBe(404);
	});

	it('delete removes the client and its tokens; 404 if unknown', async () => {
		await seedClient(db(), 'bot', { scopes: ['users:read'] });
		const { token } = await issueClientToken(db(), 'bot', ['users:read']);
		expect((await api('DELETE', '/clients/bot', admin)).status).toBe(204);
		expect(await validateClientToken(db(), token)).toBeNull();
		expect(await clientIds()).toEqual(['admin-tool']);
		expect((await api('DELETE', '/clients/bot', admin)).status).toBe(404);
	});

	it('403 unless a global:admin user logged in through a clients:manage client', async () => {
		await seedClient(db(), 'community', { scopes: ['users:read', 'users:write'] });
		await seedClient(db(), 'bot', { scopes: ['clients:manage'] });
		const tokens = [
			// not an admin, though the client could
			(await createSession(db(), '2', 'admin-tool')).token,
			// an admin, through a client that lacks clients:manage, or through none
			(await createSession(db(), '1', 'community')).token,
			(await createSession(db(), '1')).token,
			// a service's own token, even with clients:manage
			(await issueClientToken(db(), 'bot', ['clients:manage'])).token
		];
		for (const token of tokens) {
			expect((await api('GET', '/clients', token)).status).toBe(403);
			expect(
				(await api('POST', '/clients', token, { client_id: 'x', scopes: ['users:read'] })).status
			).toBe(403);
			expect((await api('PATCH', '/clients/community', token, { scopes: [] })).status).toBe(403);
			expect((await api('POST', '/clients/community/rotate', token)).status).toBe(403);
			expect((await api('DELETE', '/clients/community', token)).status).toBe(403);
		}
		expect(await clientIds()).toEqual(['admin-tool', 'bot', 'community']);
	});
});
