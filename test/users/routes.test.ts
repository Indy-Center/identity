// test/users/routes.test.ts
import { env, exports } from 'cloudflare:workers';
import { beforeEach, describe, expect, it } from 'vitest';
import { makeDb } from '../../src/db';
import { clients, clientTokens, sessions, userRoles, users } from '../../src/schema';
import { issueClientToken } from '../../src/clients/domain';
import { createSession } from '../../src/sessions/domain';
import { getUser, upsertFromVatsim } from '../../src/users/domain';
import { listRoleGrants } from '../../src/users/roles';
import type { Scope } from '../../src/schema';
import { makeVatsimProfile, seedClient } from '../helpers/fixtures';

const BASE = 'https://id.flyindycenter.com/api';
const db = () => makeDb(env.DB);

beforeEach(async () => {
	for (const t of [clientTokens, clients, userRoles, sessions, users]) {
		await db().delete(t);
	}
	await upsertFromVatsim(db(), makeVatsimProfile({ cid: '1' }));
	await upsertFromVatsim(db(), makeVatsimProfile({ cid: '2' }));
});

async function clientToken(id: string, scopes: Scope[]): Promise<string> {
	await seedClient(db(), id, { scopes });
	return (await issueClientToken(db(), id, scopes)).token;
}

async function userToken(cid: string, roles: string[] = []): Promise<string> {
	for (const role of roles) {
		await db().insert(userRoles).values({ cid, role, source: 'cli', grantedAt: 1 });
	}
	return (await createSession(db(), cid)).token;
}

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

const errorCode = async (res: Response) =>
	((await res.json()) as { error: { code: string } }).error.code;

describe('GET /api/users', () => {
	it('returns claims without email, and 404 for unknown', async () => {
		const token = await clientToken('bot', ['users:read']);
		const res = await api('GET', '/users/1', token);
		expect(res.status).toBe(200);
		expect(res.headers.get('Access-Control-Allow-Origin')).toBeNull();
		const body = (await res.json()) as Record<string, unknown>;
		expect(body.sub).toBe('1');
		expect(JSON.stringify(body)).not.toContain('test@example.com');
		expect(body).not.toHaveProperty('email');
		expect(body).not.toHaveProperty('vatsim_profile');
		expect((await api('GET', '/users/999', token)).status).toBe(404);
	});

	it('sends no CORS headers, even to a browser origin', async () => {
		const token = await clientToken('bot', ['users:read']);
		const res = await exports.default.fetch(`${BASE}/users/1`, {
			headers: { Authorization: `Bearer ${token}`, Origin: 'https://www.flyindycenter.com' }
		});
		expect(res.headers.get('Access-Control-Allow-Origin')).toBeNull();
		expect(res.headers.get('Access-Control-Allow-Credentials')).toBeNull();
	});

	it('lists by role or discord_id, requiring exactly one filter', async () => {
		const token = await clientToken('bot', ['users:read', 'users:write']);
		await api('PATCH', '/users/2', token, { discord_id: '222222222222222222' });
		await api('PATCH', '/users/1/roles', token, { add: ['community:admin'] });
		const byRole = (await (await api('GET', '/users?role=community:admin', token)).json()) as {
			sub: string;
			roles: string[];
		}[];
		expect(byRole.map((u) => u.sub)).toEqual(['1']);
		expect(byRole[0]!.roles).toEqual(['community:admin']);
		expect(JSON.stringify(byRole)).not.toContain('test@example.com');
		const byDiscord = (await (
			await api('GET', '/users?discord_id=222222222222222222', token)
		).json()) as {
			sub: string;
		}[];
		expect(byDiscord.map((u) => u.sub)).toEqual(['2']);
		expect(await errorCode(await api('GET', '/users', token))).toBe('validation_failed');
		expect(await errorCode(await api('GET', '/users?role=a:b&discord_id=1', token))).toBe(
			'validation_failed'
		);
	});

	it('lists 150 holders of a role, each with all of their own roles', async () => {
		const token = await clientToken('bot', ['users:read']);
		const cids = Array.from({ length: 150 }, (_, i) => String(1000 + i));
		const now = Date.now();
		const row = (cid: string) => ({
			cid,
			email: `${cid}@example.com`,
			vatsimProfile: makeVatsimProfile({ cid }),
			vatsimSyncedAt: now,
			createdAt: now,
			updatedAt: now
		});
		await db().batch([
			db().insert(users).values(row('0')),
			...cids.map((cid) => db().insert(users).values(row(cid))),
			...cids.map((cid) =>
				db()
					.insert(userRoles)
					.values({ cid, role: 'community:member', source: 'cli', grantedAt: now })
			),
			...cids.map((cid) =>
				db()
					.insert(userRoles)
					.values({ cid, role: `z:u${cid}`, source: 'cli', grantedAt: now })
			)
		]);
		const res = await api('GET', '/users?role=community:member', token);
		expect(res.status).toBe(200);
		const body = (await res.json()) as { sub: string; roles: string[] }[];
		expect(body.map((u) => u.sub).sort()).toEqual(cids);
		expect(JSON.stringify(body)).not.toContain('@example.com');
		for (const u of body) {
			expect(u.roles).toEqual(['community:member', `z:u${u.sub}`]);
		}
	});
});

describe('PATCH /api/users/:cid', () => {
	it('updates identity fields with users:write', async () => {
		const token = await clientToken('community', ['users:write']);
		const res = await api('PATCH', '/users/1', token, {
			preferred_name: 'Pat',
			operating_initials: 'PQ'
		});
		expect(res.status).toBe(200);
		expect(await res.json()).toMatchObject({ sub: '1', name: 'Pat', operating_initials: 'PQ' });
	});

	it('disables a user and ends their sessions', async () => {
		const token = await clientToken('community', ['users:write']);
		const victim = await userToken('2');
		const res = await api('PATCH', '/users/2', token, { active: false, disabled_reason: 'spam' });
		expect(await res.json()).toMatchObject({ active: false });
		expect((await api('PATCH', '/me', victim, { pronouns: 'x' })).status).toBe(401);
		expect((await db().select().from(sessions).all()).filter((s) => s.cid === '2')).toEqual([]);
	});

	it('409 on duplicate discord id, 403 for read-only, 400 for unknown keys', async () => {
		const write = await clientToken('community', ['users:write']);
		const read = await clientToken('bot', ['users:read']);
		await api('PATCH', '/users/1', write, { discord_id: '111111111111111111' });
		expect(
			(await api('PATCH', '/users/2', write, { discord_id: '111111111111111111' })).status
		).toBe(409);
		expect(await errorCode(await api('PATCH', '/users/1', read, { pronouns: 'x' }))).toBe(
			'insufficient_scope'
		);
		expect((await api('PATCH', '/users/1', write, { email: 'x@y.z' })).status).toBe(400);
	});

	it('400 validation_failed for malformed JSON or a non-JSON content type', async () => {
		const token = await clientToken('community', ['users:write']);
		const send = (contentType: string, body: string) =>
			exports.default.fetch(`${BASE}/users/1`, {
				method: 'PATCH',
				headers: { Authorization: `Bearer ${token}`, 'Content-Type': contentType },
				body
			});
		const malformed = await send('application/json', '{bad');
		expect(malformed.status).toBe(400);
		expect(await errorCode(malformed)).toBe('validation_failed');
		const plain = await send('text/plain', '{"active":false}');
		expect(plain.status).toBe(400);
		expect(await errorCode(plain)).toBe('validation_failed');
		const missing = await exports.default.fetch(`${BASE}/users/1`, {
			method: 'PATCH',
			headers: { Authorization: `Bearer ${token}` },
			body: '{"active":false}'
		});
		expect(await errorCode(missing)).toBe('validation_failed');
		expect((await getUser(db(), '1'))?.active).toBe(true);
	});

	it('rejects disabled_reason unless active is false in the same body', async () => {
		const token = await clientToken('community', ['users:write']);
		expect(
			await errorCode(await api('PATCH', '/users/1', token, { disabled_reason: 'spam' }))
		).toBe('validation_failed');
		expect(
			(await api('PATCH', '/users/1', token, { active: true, disabled_reason: 'spam' })).status
		).toBe(400);
		expect(
			(await api('PATCH', '/users/1', token, { active: false, disabled_reason: 'spam' })).status
		).toBe(200);
	});

	it('404 for an unknown cid', async () => {
		const token = await clientToken('community', ['users:write']);
		expect((await api('PATCH', '/users/999', token, { pronouns: 'x' })).status).toBe(404);
	});
});

describe('/api/users/:cid/roles', () => {
	it('patches with the caller source and lists grants', async () => {
		const community = await clientToken('community', ['users:write']);
		const bot = await clientToken('discord-bot', ['users:write']);
		await api('PATCH', '/users/1/roles', community, { add: ['feedback:full'] });
		const res = await api('PATCH', '/users/1/roles', bot, { add: ['discord:mod'], remove: ['*'] });
		expect(await res.json()).toEqual({ roles: ['discord:mod', 'feedback:full'] });
		const read = await clientToken('reader', ['users:read']);
		expect(await (await api('GET', '/users/1/roles', read)).json()).toEqual([
			{ role: 'discord:mod', source: 'discord-bot' },
			{ role: 'feedback:full', source: 'community' }
		]);
	});

	it('validates names and refuses global roles', async () => {
		const token = await clientToken('community', ['users:write']);
		expect((await api('PATCH', '/users/1/roles', token, { add: ['admin'] })).status).toBe(400);
		expect((await api('PATCH', '/users/1/roles', token, { add: ['community:*'] })).status).toBe(
			400
		);
		expect((await api('PATCH', '/users/1/roles', token, { add: ['global:admin'] })).status).toBe(
			403
		);
		expect(await listRoleGrants(db(), '1')).toEqual([]);
	});

	it('accepts 100 adds in one call and rejects 101', async () => {
		const token = await clientToken('community', ['users:write']);
		const roles = Array.from({ length: 101 }, (_, i) => `bulk:r${String(i).padStart(3, '0')}`);
		const ok = await api('PATCH', '/users/1/roles', token, { add: roles.slice(0, 100) });
		expect(ok.status).toBe(200);
		expect(((await ok.json()) as { roles: string[] }).roles).toEqual(roles.slice(0, 100));
		expect((await api('PATCH', '/users/1/roles', token, { add: roles })).status).toBe(400);
	});

	it('works for a cid that has never logged in', async () => {
		const token = await clientToken('community', ['users:write']);
		const res = await api('PATCH', '/users/5555/roles', token, { add: ['events:can_sign_up'] });
		expect(await res.json()).toEqual({ roles: ['events:can_sign_up'] });
	});
});

describe('users as principals', () => {
	it('a plain user edits only their own profile fields via /api/me', async () => {
		const token = await userToken('1');
		const res = await api('PATCH', '/me', token, { preferred_name: 'Me', pronouns: 'they/them' });
		expect(res.status).toBe(200);
		expect(await res.json()).toMatchObject({ sub: '1', name: 'Me', email: 'test@example.com' });
		for (const body of [
			{ roles: ['a:b'] },
			{ discord_id: '1' },
			{ operating_initials: 'AB' },
			{ active: false }
		]) {
			expect((await api('PATCH', '/me', token, body)).status).toBe(400);
		}
		expect(await errorCode(await api('PATCH', '/users/1/roles', token, { add: ['a:b'] }))).toBe(
			'insufficient_scope'
		);
		expect((await api('GET', '/users/2', token)).status).toBe(403);
		expect((await api('PATCH', '/users/2', token, { pronouns: 'x' })).status).toBe(403);
	});

	it('/api/me is for users only', async () => {
		const token = await clientToken('community', ['users:write']);
		expect((await api('PATCH', '/me', token, { pronouns: 'x' })).status).toBe(403);
	});

	it('a global:admin user can edit others, with role writes sourced user:<cid>', async () => {
		const admin = await userToken('1', ['global:admin']);
		expect((await api('PATCH', '/users/2', admin, { pronouns: 'she/her' })).status).toBe(200);
		await api('PATCH', '/users/2/roles', admin, { add: ['events:can_sign_up'] });
		expect(await listRoleGrants(db(), '2')).toEqual([
			{ role: 'events:can_sign_up', source: 'user:1' }
		]);
	});
});
