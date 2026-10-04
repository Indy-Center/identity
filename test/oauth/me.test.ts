import { env, exports } from 'cloudflare:workers';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { makeDb } from '../../src/db';
import { sessions, userRoles, users } from '../../src/schema';
import { createSession } from '../../src/sessions/domain';
import { setUserActive, upsertFromVatsim } from '../../src/users/domain';
import { makeVatsimProfile } from '../helpers/fixtures';

const URL = 'https://id.flyindycenter.com/me';
const db = () => makeDb(env.DB);

beforeEach(async () => {
	for (const t of [userRoles, sessions, users]) {
		await db().delete(t);
	}
	await upsertFromVatsim(db(), makeVatsimProfile({ cid: '1' }));
	// The VATSIM activity feeds: offline here, so both lookups degrade to null.
	vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('offline'));
});

afterEach(() => {
	vi.restoreAllMocks();
});

const withCookie = (token: string, headers: Record<string, string> = {}) =>
	exports.default.fetch(URL, {
		headers: { Cookie: `__Host-identity_session=${token}`, ...headers }
	});

describe('GET /me', () => {
	it("shows the signed-in browser's own record, with email and roles", async () => {
		await db().insert(userRoles).values({ cid: '1', role: 'a:b', source: 'x', grantedAt: 1 });
		const { token } = await createSession(db(), '1');
		const res = await withCookie(token, { Origin: 'https://www.flyindycenter.com' });
		expect(res.status).toBe(200);
		expect(res.headers.get('Cache-Control')).toBe('no-store');
		expect(res.headers.get('Access-Control-Allow-Origin')).toBeNull();
		const body = await res.json();
		expect(body).toMatchObject({ sub: '1', email: 'test@example.com', roles: ['a:b'] });
		expect(body).toHaveProperty('active_session');
		expect(body).toHaveProperty('active_flight_plan');
	});

	it('401 with no cookie, a bad cookie, a bearer token alone, or a disabled user', async () => {
		const { token } = await createSession(db(), '1');
		const attempts = [
			await exports.default.fetch(URL),
			await withCookie('nope'),
			await exports.default.fetch(URL, { headers: { Authorization: `Bearer ${token}` } })
		];
		await setUserActive(db(), '1', false);
		attempts.push(await withCookie(token));
		for (const res of attempts) {
			expect(res.status).toBe(401);
			expect(res.headers.get('Cache-Control')).toBe('no-store');
		}
	});
});
