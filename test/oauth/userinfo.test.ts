import { env, exports } from 'cloudflare:workers';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { makeDb } from '../../src/db';
import { clients, clientTokens, sessions, userRoles, users } from '../../src/schema';
import { setUserActive, updateProfile, upsertFromVatsim } from '../../src/users/domain';
import { createSession } from '../../src/sessions/domain';
import { __resetCacheForTests } from '../../src/incubator/presence/domain';
import { __resetCacheForTests as __resetFlightPlansForTests } from '../../src/incubator/flight-plans/domain';
import type { OnlineController } from '../../src/incubator/presence/schema';
import type { FlightPlan } from '../../src/incubator/flight-plans/schema';
import { issueClientToken } from '../../src/clients/domain';
import { makeVatsimProfile, seedClient } from '../helpers/fixtures';

const USERINFO = 'https://id.flyindycenter.com/oauth/userinfo';

beforeEach(async () => {
	const db = makeDb(env.DB);
	await db.delete(userRoles);
	await db.delete(sessions);
	await db.delete(users);
	await db.delete(clientTokens);
	await db.delete(clients);
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

async function seed(): Promise<{ cid: string; token: string }> {
	const db = makeDb(env.DB);
	const { cid } = await upsertFromVatsim(
		db,
		makeVatsimProfile({
			cid: '7',
			personal: { name_first: 'Pat', name_last: 'Quinn', email: 'pat@example.com' }
		})
	);
	await db.insert(userRoles).values({ cid, role: 'community:admin', source: 'test', grantedAt: 1 });
	const { token } = await createSession(db, cid);
	return { cid, token };
}

function userinfo(token: string): Promise<Response> {
	return exports.default.fetch(USERINFO, { headers: { Authorization: `Bearer ${token}` } });
}

async function expectInvalidToken(res: Response) {
	expect(res.status).toBe(401);
	expect(res.headers.get('Cache-Control')).toBe('no-store');
	expect(res.headers.get('WWW-Authenticate')).toBe('Bearer error="invalid_token"');
	expect(await res.json()).toEqual({ error: 'invalid_token' });
}

describe('GET /oauth/userinfo', () => {
	it('returns flat claims with email and presence', async () => {
		const { token } = await seed();
		const res = await userinfo(token);
		expect(res.status).toBe(200);
		expect(res.headers.get('Cache-Control')).toBe('no-store');
		expect(await res.json()).toEqual({
			sub: '7',
			email: 'pat@example.com',
			name: 'Pat Quinn',
			given_name: 'Pat',
			family_name: 'Quinn',
			preferred_name: null,
			pronouns: null,
			rating: 'OBS',
			pilot_rating: null,
			division: null,
			region: null,
			subdivision: null,
			roles: ['community:admin'],
			operating_initials: null,
			discord_id: null,
			teamspeak_uid: null,
			active: true,
			active_session: null,
			active_flight_plan: null
		});
	});

	it('uses the preferred name for name', async () => {
		const { cid, token } = await seed();
		await updateProfile(makeDb(env.DB), cid, { preferredName: 'PQ' });
		expect(((await (await userinfo(token)).json()) as { name: string }).name).toBe('PQ');
	});

	it('includes the live controller session and filed flight plan', async () => {
		const { token } = await seed();
		const controller = {
			artccId: 'ZID',
			primaryFacilityId: 'IND',
			primaryPositionId: 'TWR',
			role: 'controller',
			positions: [],
			isActive: true,
			isObserver: false,
			loginTime: '2026-05-15T10:00:00Z',
			vatsimData: {
				cid: '7',
				realName: 'Pat Quinn',
				controllerInfo: '',
				userRating: 'S2',
				callsign: 'IND_TWR',
				loginTime: '2026-05-15T10:00:00Z'
			}
		} satisfies OnlineController;
		const plan: FlightPlan = {
			departure: 'KIND',
			arrival: 'KCMH',
			alternate: 'KDAY',
			flight_rules: 'I',
			aircraft: 'B738/L'
		};
		vi.mocked(globalThis.fetch).mockImplementation(async (url) => {
			const u = String(url);
			if (u.includes('live.env.vnas.vatsim.net')) {
				return Response.json({ controllers: [controller] });
			}
			if (u.includes('data.vatsim.net')) {
				return Response.json({ pilots: [{ cid: 7, flight_plan: plan }] });
			}
			return new Response('not found', { status: 404 });
		});
		const body = (await (await userinfo(token)).json()) as {
			active_session: OnlineController | null;
			active_flight_plan: FlightPlan | null;
		};
		expect(body.active_session?.vatsimData.callsign).toBe('IND_TWR');
		expect(body.active_flight_plan?.departure).toBe('KIND');
	});

	it('rejects a disabled user', async () => {
		const { cid, token } = await seed();
		await setUserActive(makeDb(env.DB), cid, false);
		await expectInvalidToken(await userinfo(token));
	});

	it('rejects a missing or unknown token', async () => {
		await expectInvalidToken(await exports.default.fetch(USERINFO));
		await expectInvalidToken(await userinfo('nope'));
	});

	it('rejects an empty bearer token', async () => {
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

describe('GET /oauth/userinfo with a client token', () => {
	it('401s: a client-credentials token is not a user session', async () => {
		const db = makeDb(env.DB);
		await seedClient(db, 'bot', { scopes: ['users:read'] });
		const { token } = await issueClientToken(db, 'bot', ['users:read']);
		const res = await exports.default.fetch(USERINFO, {
			headers: { Authorization: `Bearer ${token}` }
		});
		expect(res.status).toBe(401);
		expect(((await res.json()) as { error: string }).error).toBe('invalid_token');
	});
});
