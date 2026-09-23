// test/published-surface/consumer.test.ts
// Smoke test that the emitted dist surface is what we expect. Imports from
// `../../dist` (relative to dist after build:lib) so that the test exercises
// what consumers will actually receive.
//
// If this file fails to compile, the package contract is broken. The test
// runtime body is trivial — the assertions are the imports themselves.

import { describe, it, expect } from 'vitest';
import type {
	SessionContext,
	OnlineController,
	VnasPosition,
	VnasVatsimData,
	User,
	VatsimProfile,
	Attributes,
	AttributePatch,
	OperatingInitials,
	FlightPlan,
	ErrorCode
} from '../../dist';
import { IdentityError, getStatusForCode, createIdentityClient, SESSION_COOKIE } from '../../dist';

describe('published surface', () => {
	it('exposes the expected types', () => {
		// Force the type imports to be retained by referencing them in a way TS
		// can't elide. The body just checks that constants typed against the
		// imported types can be constructed.
		const ctx: SessionContext = {
			user: {} as User,
			roles: [],
			sessionExpiresAt: new Date(),
			activeSession: null,
			activeFlightPlan: null
		};
		const c: OnlineController = {} as OnlineController;
		const p: VnasPosition = {} as VnasPosition;
		const v: VnasVatsimData = {} as VnasVatsimData;
		const u: User = {} as User;
		const vp: VatsimProfile = {} as VatsimProfile;
		const a: Attributes = {};
		const ap: AttributePatch = {};
		const oi: OperatingInitials = 'AB';
		const fp: FlightPlan = { departure: 'KIND', arrival: 'KORD' };
		expect(ctx).toBeDefined();
		expect([c, p, v, u, vp, a, ap, oi, fp]).toHaveLength(9);
	});

	it('exposes IdentityError as a runtime export', () => {
		const err = new IdentityError('invalid_code', 400, 'bad code');
		expect(err.name).toBe('IdentityError:invalid_code');
		expect(getStatusForCode('invalid_code')).toBe(400);
		const code: ErrorCode = err.code;
		expect(code).toBe('invalid_code');
	});

	it('exposes the client factory as a runtime export', () => {
		const client = createIdentityClient();
		expect(client.loginUrl('http://localhost:5173/')).toContain('/oauth/authorize?');
		expect(SESSION_COOKIE).toBe('fic_session');
	});
});
