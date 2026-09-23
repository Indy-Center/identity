import { env, exports } from 'cloudflare:workers';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { makeDb } from '../../src/db';
import { sessions, users } from '../../src/schema';
import { upsertFromVatsim } from '../../src/users/domain';
import { createSession } from '../../src/sessions/domain';
import { __resetCacheForTests } from '../../src/online-controllers/domain';
import { __resetCacheForTests as __resetFlightPlansForTests } from '../../src/flight-plans/domain';
import { makeVatsimProfile } from '../helpers/fixtures';

const BASE = 'https://auth.flyindycenter.com';

beforeEach(async () => {
	const db = makeDb(env.DB);
	await db.delete(sessions);
	await db.delete(users);
	vi.spyOn(globalThis, 'fetch').mockImplementation(
		async () => new Response('not found', { status: 404 })
	);
});

afterEach(() => {
	__resetCacheForTests();
	__resetFlightPlansForTests();
	vi.restoreAllMocks();
});

function revoke(token: string): Promise<Response> {
	return exports.default.fetch(`${BASE}/oauth/revoke`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
		body: new URLSearchParams({ token }).toString()
	});
}

describe('POST /oauth/revoke', () => {
	it('invalidates the token; userinfo is then 401', async () => {
		const db = makeDb(env.DB);
		const { id: userId } = await upsertFromVatsim(db, makeVatsimProfile({ cid: '1' }));
		const { token } = await createSession(db, userId);

		const res = await revoke(token);
		expect(res.status).toBe(200);
		expect(await res.text()).toBe('');
		expect(await db.select().from(sessions).all()).toHaveLength(0);

		const after = await exports.default.fetch(`${BASE}/oauth/userinfo`, {
			headers: { Authorization: `Bearer ${token}` }
		});
		expect(after.status).toBe(401);
	});

	it('returns 200 for an unknown token', async () => {
		expect((await revoke('unknown')).status).toBe(200);
	});

	it('returns 200 with no token at all', async () => {
		const res = await exports.default.fetch(`${BASE}/oauth/revoke`, { method: 'POST' });
		expect(res.status).toBe(200);
	});
});
