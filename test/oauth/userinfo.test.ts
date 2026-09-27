import { env, exports } from 'cloudflare:workers';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { makeDb } from '../../src/db';
import { sessions, userRoles, users } from '../../src/schema';
import { upsertFromVatsim } from '../../src/users/domain';
import { createSession } from '../../src/sessions/domain';
import { __resetCacheForTests } from '../../src/incubator/presence/domain';
import { __resetCacheForTests as __resetFlightPlansForTests } from '../../src/incubator/flight-plans/domain';
import { makeVatsimProfile } from '../helpers/fixtures';

const USERINFO = 'https://id.flyindycenter.com/oauth/userinfo';

beforeEach(async () => {
	const db = makeDb(env.DB);
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

async function seed(): Promise<{ userId: string; token: string }> {
	const db = makeDb(env.DB);
	const { cid: userId } = await upsertFromVatsim(
		db,
		makeVatsimProfile({
			cid: '7',
			personal: { name_first: 'Pat', name_last: 'Quinn', email: 'pat@example.com' }
		})
	);
	await db
		.insert(userRoles)
		.values({ cid: userId, role: 'zid:admin', source: 'test', grantedAt: Date.now() });
	const { token } = await createSession(db, userId);
	return { userId, token };
}

async function expectInvalidToken(res: Response) {
	expect(res.status).toBe(401);
	expect(res.headers.get('WWW-Authenticate')).toBe('Bearer error="invalid_token"');
	expect(await res.json()).toEqual({ error: 'invalid_token' });
}

describe('GET /oauth/userinfo', () => {
	it('returns standard claims plus the session context, dates as ISO strings', async () => {
		const { token } = await seed();
		const res = await exports.default.fetch(USERINFO, {
			headers: { Authorization: `Bearer ${token}` }
		});
		expect(res.status).toBe(200);
		expect(res.headers.get('Cache-Control')).toBe('no-store');
		const body = (await res.json()) as {
			sub: string;
			email: string;
			name: string;
			user: { cid: string };
			roles: string[];
			sessionExpiresAt: string;
			activeSession: null;
			activeFlightPlan: null;
		};
		expect(body.sub).toBe('7');
		expect(body.email).toBe('pat@example.com');
		expect(body.name).toBe('Pat Quinn');
		expect(body.user.cid).toBe('7');
		expect(body.roles).toEqual(['zid:admin']);
		expect(body.sessionExpiresAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
		expect(new Date(body.sessionExpiresAt).getTime()).toBeGreaterThan(Date.now());
		expect(body.activeSession).toBeNull();
		expect(body.activeFlightPlan).toBeNull();
	});

	it('401s with invalid_token for a missing token', async () => {
		await expectInvalidToken(await exports.default.fetch(USERINFO));
	});

	it('401s with invalid_token for an unknown token', async () => {
		await expectInvalidToken(
			await exports.default.fetch(USERINFO, { headers: { Authorization: 'Bearer nope' } })
		);
	});

	it('401s with invalid_token for an empty bearer token', async () => {
		await expectInvalidToken(
			await exports.default.fetch(USERINFO, { headers: { Authorization: 'Bearer ' } })
		);
	});

	it('accepts a lower-case "bearer" scheme', async () => {
		const { token } = await seed();
		const res = await exports.default.fetch(USERINFO, {
			headers: { Authorization: `bearer ${token}` }
		});
		expect(res.status).toBe(200);
	});

	it('ignores cookies: a valid token in a cookie alone is 401', async () => {
		const { token } = await seed();
		await expectInvalidToken(
			await exports.default.fetch(USERINFO, {
				headers: { Cookie: `fic_session=${token}; __Host-identity_session=${token}` }
			})
		);
	});
});
