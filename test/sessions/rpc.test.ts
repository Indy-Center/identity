import { env } from 'cloudflare:workers';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { makeDb } from '../../src/db';
import { users, sessions, userRoles } from '../../src/schema';
import { upsertFromVatsim } from '../../src/users/domain';
import { createSession } from '../../src/sessions/domain';
import { makeVatsimProfile } from '../helpers/fixtures';
import { __resetCacheForTests } from '../../src/online-controllers/domain';
import type { OnlineController } from '../../src/online-controllers/types';
import { __resetCacheForTests as __resetFlightPlansForTests } from '../../src/flight-plans/domain';
import type { FlightPlan } from '../../src/flight-plans/types';

beforeEach(async () => {
	const db = makeDb(env.DB);
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

describe('rpc/sessions', () => {
	it('invalidateSession deletes the row', async () => {
		const db = makeDb(env.DB);
		const { id: userId } = await upsertFromVatsim(db, makeVatsimProfile({ cid: '1' }));
		const { token } = await createSession(db, userId);
		await env.IDENTITY.invalidateSession(token);
		expect(await db.select().from(sessions).all()).toHaveLength(0);
	});

	it('invalidateUserSessions deletes all sessions for a user', async () => {
		const db = makeDb(env.DB);
		const { id: userId } = await upsertFromVatsim(db, makeVatsimProfile({ cid: '1' }));
		await createSession(db, userId);
		await createSession(db, userId);
		await env.IDENTITY.invalidateUserSessions(userId);
		expect(await db.select().from(sessions).all()).toHaveLength(0);
	});
});

describe('rpc/getSessionContext', () => {
	it('returns null for an unknown token', async () => {
		mockBothFeeds([], []);
		expect(await env.IDENTITY.getSessionContext('nope')).toBeNull();
	});

	it('returns null after the session is invalidated', async () => {
		const db = makeDb(env.DB);
		const { id: userId } = await upsertFromVatsim(db, makeVatsimProfile({ cid: '5' }));
		const { token } = await createSession(db, userId);
		mockBothFeeds([], []);
		await env.IDENTITY.invalidateSession(token);
		expect(await env.IDENTITY.getSessionContext(token)).toBeNull();
	});

	it('returns the joined context with activeSession: null when user is offline', async () => {
		const db = makeDb(env.DB);
		const { id: userId } = await upsertFromVatsim(db, makeVatsimProfile({ cid: '7' }));
		const { token } = await createSession(db, userId);
		await db.insert(userRoles).values({ userId, role: 'zid:admin', grantedAt: Date.now() });
		mockBothFeeds([], []);

		const ctx = await env.IDENTITY.getSessionContext(token);
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

		const ctx = await env.IDENTITY.getSessionContext(token);
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

		const ctx = await env.IDENTITY.getSessionContext(token);
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
		const ctx = await env.IDENTITY.getSessionContext(token);
		expect(ctx).not.toBeNull();
		expect(ctx!.activeFlightPlan).toBeNull();
	});

	it('returns activeFlightPlan: null when the pilot is connected without a filed plan', async () => {
		const db = makeDb(env.DB);
		const { id: userId } = await upsertFromVatsim(db, makeVatsimProfile({ cid: '999' }));
		const { token } = await createSession(db, userId);
		mockBothFeeds([], [{ cid: 999, flight_plan: null }]);
		const ctx = await env.IDENTITY.getSessionContext(token);
		expect(ctx).not.toBeNull();
		expect(ctx!.activeFlightPlan).toBeNull();
	});
});
