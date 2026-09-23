import { env, exports } from 'cloudflare:workers';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { makeDb } from '../../src/db';
import { sessions, users } from '../../src/schema';
import { upsertFromVatsim } from '../../src/users/domain';
import { createSession, validateSession } from '../../src/sessions/domain';
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
		const res = await exports.default.fetch(`${BASE}/oauth/revoke`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
		});
		expect(res.status).toBe(200);
	});

	it('rejects a JSON body with invalid_request', async () => {
		const res = await exports.default.fetch(`${BASE}/oauth/revoke`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ token: 'whatever' })
		});
		expect(res.status).toBe(400);
		expect(res.headers.get('Cache-Control')).toBe('no-store');
		const body = (await res.json()) as { error: string; error_description?: string };
		expect(body.error).toBe('invalid_request');
		expect(body.error_description).toBeTruthy();
	});

	it('revokes only the targeted session, leaving the other valid', async () => {
		const db = makeDb(env.DB);
		const { id: userId } = await upsertFromVatsim(db, makeVatsimProfile({ cid: '2' }));
		const { token: tokenA } = await createSession(db, userId);
		const { token: tokenB } = await createSession(db, userId);

		const res = await revoke(tokenA);
		expect(res.status).toBe(200);

		expect(await validateSession(db, tokenA)).toBeNull();
		expect((await validateSession(db, tokenB))?.userId).toBe(userId);
	});
});
