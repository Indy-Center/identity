import { env } from 'cloudflare:workers';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { makeDb } from '../../src/db';
import { authorizationCodes, users, sessions, userRoles } from '../../src/schema';
import { upsertFromVatsim, setUserActive } from '../../src/users/domain';
import { createSession, validateSession } from '../../src/sessions/domain';
import { exchangeCodeForSession, getSessionContext, logout } from '../../src/sessions/context';
import { createAuthorizationCode } from '../../src/authorization-codes/domain';
import { IdentityError } from '../../src/client/errors';
import { makeVatsimProfile } from '../helpers/fixtures';
import { __resetCacheForTests } from '../../src/online-controllers/domain';
import type { OnlineController } from '../../src/online-controllers/types';
import { __resetCacheForTests as __resetFlightPlansForTests } from '../../src/flight-plans/domain';
import type { FlightPlan } from '../../src/flight-plans/types';

beforeEach(async () => {
	const db = makeDb(env.DB);
	await db.delete(authorizationCodes);
	await db.delete(userRoles);
	await db.delete(sessions);
	await db.delete(users);
});

afterEach(() => {
	__resetCacheForTests();
	__resetFlightPlansForTests();
	vi.restoreAllMocks();
});

function mockBothFeeds(
	controllers: OnlineController[],
	pilots: { cid: number; flight_plan: FlightPlan | null }[]
) {
	vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
		const u = String(url);
		if (u.includes('live.env.vnas.vatsim.net')) {
			return new Response(JSON.stringify({ controllers }), {
				status: 200,
				headers: { 'content-type': 'application/json' }
			});
		}
		if (u.includes('data.vatsim.net')) {
			return new Response(
				JSON.stringify({ pilots: pilots.map((p) => ({ cid: p.cid, flight_plan: p.flight_plan })) }),
				{
					status: 200,
					headers: { 'content-type': 'application/json' }
				}
			);
		}
		return new Response('not found', { status: 404 });
	});
}

describe('logout', () => {
	it('deletes the session row', async () => {
		const db = makeDb(env.DB);
		const { id: userId } = await upsertFromVatsim(db, makeVatsimProfile({ cid: '1' }));
		const { token } = await createSession(db, userId);
		await logout(env, token);
		expect(await db.select().from(sessions).all()).toHaveLength(0);
	});

	it('is a no-op for an unknown token', async () => {
		await expect(logout(env, 'nope')).resolves.toBeUndefined();
	});
});

describe('getSessionContext', () => {
	it('returns null for an unknown token', async () => {
		mockBothFeeds([], []);
		expect(await getSessionContext(env, 'nope')).toBeNull();
	});

	it('returns null after the session is invalidated', async () => {
		const db = makeDb(env.DB);
		const { id: userId } = await upsertFromVatsim(db, makeVatsimProfile({ cid: '5' }));
		const { token } = await createSession(db, userId);
		mockBothFeeds([], []);
		await logout(env, token);
		expect(await getSessionContext(env, token)).toBeNull();
	});

	it('returns the joined context with activeSession: null when user is offline', async () => {
		const db = makeDb(env.DB);
		const { id: userId } = await upsertFromVatsim(db, makeVatsimProfile({ cid: '7' }));
		const { token } = await createSession(db, userId);
		await db.insert(userRoles).values({ userId, role: 'zid:admin', grantedAt: Date.now() });
		mockBothFeeds([], []);

		const ctx = await getSessionContext(env, token);
		expect(ctx).not.toBeNull();
		expect(ctx!.user.cid).toBe('7');
		expect(ctx!.roles).toEqual(['zid:admin']);
		expect(ctx!.activeSession).toBeNull();
		expect(ctx!.sessionExpiresAt).toBeInstanceOf(Date);
	});

	it('returns activeSession when the user is currently controlling', async () => {
		const db = makeDb(env.DB);
		const { id: userId } = await upsertFromVatsim(db, makeVatsimProfile({ cid: '42' }));
		const { token } = await createSession(db, userId);

		const controller: OnlineController = {
			artccId: 'ZID',
			primaryFacilityId: 'IND',
			primaryPositionId: 'TWR',
			role: 'controller',
			positions: [],
			isActive: true,
			isObserver: false,
			loginTime: '2026-05-15T10:00:00Z',
			vatsimData: {
				cid: '42',
				realName: 'Test Controller',
				controllerInfo: '',
				userRating: 'S2',
				callsign: 'IND_TWR',
				loginTime: '2026-05-15T10:00:00Z'
			}
		};
		mockBothFeeds([controller], []);

		const ctx = await getSessionContext(env, token);
		expect(ctx).not.toBeNull();
		expect(ctx!.activeSession).not.toBeNull();
		expect(ctx!.activeSession!.artccId).toBe('ZID');
		expect(ctx!.activeSession!.vatsimData.cid).toBe('42');
	});

	it('returns activeFlightPlan when the pilot has filed a plan', async () => {
		const db = makeDb(env.DB);
		const { id: userId } = await upsertFromVatsim(db, makeVatsimProfile({ cid: '777' }));
		const { token } = await createSession(db, userId);

		const fp: FlightPlan = {
			departure: 'KIND',
			arrival: 'KCMH',
			alternate: 'KDAY',
			flight_rules: 'I',
			aircraft: 'B738/L'
		};
		mockBothFeeds([], [{ cid: 777, flight_plan: fp }]);

		const ctx = await getSessionContext(env, token);
		expect(ctx).not.toBeNull();
		expect(ctx!.activeFlightPlan).not.toBeNull();
		expect(ctx!.activeFlightPlan!.departure).toBe('KIND');
		expect(ctx!.activeFlightPlan!.arrival).toBe('KCMH');
		expect(ctx!.activeSession).toBeNull();
	});

	it('returns activeFlightPlan: null for a logged-in user not piloting', async () => {
		const db = makeDb(env.DB);
		const { id: userId } = await upsertFromVatsim(db, makeVatsimProfile({ cid: '888' }));
		const { token } = await createSession(db, userId);
		mockBothFeeds([], []);
		const ctx = await getSessionContext(env, token);
		expect(ctx).not.toBeNull();
		expect(ctx!.activeFlightPlan).toBeNull();
	});

	it('returns activeFlightPlan: null when the pilot is connected without a filed plan', async () => {
		const db = makeDb(env.DB);
		const { id: userId } = await upsertFromVatsim(db, makeVatsimProfile({ cid: '999' }));
		const { token } = await createSession(db, userId);
		mockBothFeeds([], [{ cid: 999, flight_plan: null }]);
		const ctx = await getSessionContext(env, token);
		expect(ctx).not.toBeNull();
		expect(ctx!.activeFlightPlan).toBeNull();
	});
});

describe('exchangeCodeForSession', () => {
	const REDIRECT = 'http://localhost:5173/';

	it('returns a session for a fresh code', async () => {
		const db = makeDb(env.DB);
		const { id: userId } = await upsertFromVatsim(db, makeVatsimProfile({ cid: '3' }));
		const { code } = await createAuthorizationCode(db, userId, REDIRECT);
		mockBothFeeds([], []);

		const result = await exchangeCodeForSession(env, code, REDIRECT);
		expect(result.token).toMatch(/^[a-z2-7]{32}$/);
		expect(result.expiresAt).toBeInstanceOf(Date);
		expect(result.session.user.cid).toBe('3');
		expect((await validateSession(db, result.token))?.userId).toBe(userId);
	});

	it('throws IdentityError invalid_code on reuse', async () => {
		const db = makeDb(env.DB);
		const { id: userId } = await upsertFromVatsim(db, makeVatsimProfile({ cid: '4' }));
		const { code } = await createAuthorizationCode(db, userId, REDIRECT);
		mockBothFeeds([], []);

		await exchangeCodeForSession(env, code, REDIRECT);
		await expect(exchangeCodeForSession(env, code, REDIRECT)).rejects.toMatchObject({
			code: 'invalid_code',
			status: 400
		});
		await expect(exchangeCodeForSession(env, code, REDIRECT)).rejects.toBeInstanceOf(IdentityError);
	});

	it('throws IdentityError invalid_code for a mismatched redirect URI', async () => {
		const db = makeDb(env.DB);
		const { id: userId } = await upsertFromVatsim(db, makeVatsimProfile({ cid: '6' }));
		const { code } = await createAuthorizationCode(db, userId, REDIRECT);

		await expect(
			exchangeCodeForSession(env, code, 'https://charts.flyindycenter.com/')
		).rejects.toMatchObject({ code: 'invalid_code' });
	});

	it('throws IdentityError access_denied when the user was disabled before exchange', async () => {
		const db = makeDb(env.DB);
		const { id: userId } = await upsertFromVatsim(db, makeVatsimProfile({ cid: '8' }));
		const { code } = await createAuthorizationCode(db, userId, REDIRECT);
		await setUserActive(db, userId, false, { reason: 'test' });
		mockBothFeeds([], []);

		expect.assertions(3);
		try {
			await exchangeCodeForSession(env, code, REDIRECT);
		} catch (err) {
			expect(err).toBeInstanceOf(IdentityError);
			expect((err as IdentityError).code).toBe('access_denied');
			expect((err as IdentityError).status).toBe(403);
		}
	});
});
