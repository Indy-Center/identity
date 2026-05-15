// test/published-surface/consumer.test.ts
// Smoke test that the emitted dist surface is what we expect. Imports from
// `../../dist` (relative to dist after build:lib) so that the test exercises
// what consumers will actually receive.
//
// If this file fails to compile, the package contract is broken. The test
// runtime body is trivial — the assertions are the imports themselves.

import { describe, it, expect } from 'vitest';
import type {
	IdentityRpc,
	IdentityBinding,
	SessionContext,
	OnlineController,
	VnasPosition,
	VnasVatsimData,
	User,
	VatsimProfile,
	Attributes,
	AttributePatch,
	OperatingInitials,
	FlightPlan
} from '../../dist';

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
		const rpc = {
			async getSessionContext() {
				return null;
			}
		} as unknown as IdentityRpc;
		const fp: FlightPlan = { departure: 'KIND', arrival: 'KORD' };
		// IdentityBinding can't be constructed but should be assignable from any Service<IdentityRpc>.
		type _b = IdentityBinding;
		expect(ctx).toBeDefined();
		expect([c, p, v, u, vp, a, ap, oi, rpc, fp]).toHaveLength(10);
	});
});
