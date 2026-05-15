// test/flight-plans/domain.test.ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { __resetCacheForTests, ensureFresh, getFlightPlan } from '../../src/flight-plans/domain';
import type { Pilot, FlightPlan } from '../../src/flight-plans/types';

function makeFlightPlan(overrides: Partial<FlightPlan> = {}): FlightPlan {
	return {
		flight_rules: 'I',
		aircraft: 'B738/L',
		departure: 'KIND',
		arrival: 'KCMH',
		alternate: 'KDAY',
		cruise_tas: '430',
		altitude: '37000',
		deptime: '1830',
		route: 'DCT VHP DCT',
		...overrides
	};
}

function makePilot(cid: number, fp?: FlightPlan | null): Pilot {
	return {
		cid,
		name: 'Test Pilot',
		callsign: `N${cid}TP`,
		flight_plan: fp ?? null
	};
}

function mockFeed(pilots: Pilot[]) {
	return vi.spyOn(globalThis, 'fetch').mockImplementation(
		async () =>
			new Response(JSON.stringify({ pilots }), {
				status: 200,
				headers: { 'content-type': 'application/json' }
			})
	);
}

beforeEach(() => {
	__resetCacheForTests();
});

afterEach(() => {
	vi.restoreAllMocks();
	vi.useRealTimers();
});

describe('ensureFresh', () => {
	it('fetches and indexes pilots by CID on first call', async () => {
		const fetchSpy = mockFeed([makePilot(111, makeFlightPlan())]);
		await ensureFresh();
		expect(fetchSpy).toHaveBeenCalledTimes(1);
		expect(await getFlightPlan('111')).not.toBeNull();
	});

	it('skips the fetch when cache is fresh (within TTL)', async () => {
		const fetchSpy = mockFeed([makePilot(111, makeFlightPlan())]);
		vi.setSystemTime(new Date(1_000_000));
		await ensureFresh();
		vi.setSystemTime(new Date(1_000_000 + 14_000));
		await ensureFresh();
		expect(fetchSpy).toHaveBeenCalledTimes(1);
	});

	it('refetches when cache is stale (beyond TTL)', async () => {
		const fetchSpy = mockFeed([makePilot(111, makeFlightPlan())]);
		vi.setSystemTime(new Date(1_000_000));
		await ensureFresh();
		vi.setSystemTime(new Date(1_000_000 + 16_000));
		await ensureFresh();
		expect(fetchSpy).toHaveBeenCalledTimes(2);
	});

	it('coalesces concurrent calls (singleflight)', async () => {
		let resolveBody: (v: string) => void = () => {};
		const bodyPromise = new Promise<string>((res) => (resolveBody = res));
		const fetchSpy = vi
			.spyOn(globalThis, 'fetch')
			.mockReturnValue(
				bodyPromise.then(
					(b) => new Response(b, { status: 200, headers: { 'content-type': 'application/json' } })
				)
			);
		const inflight = Promise.all([ensureFresh(), ensureFresh(), ensureFresh()]);
		resolveBody(JSON.stringify({ pilots: [] }));
		await inflight;
		expect(fetchSpy).toHaveBeenCalledTimes(1);
	});

	it('preserves the previous cache when the fetch fails', async () => {
		const fetchSpy = mockFeed([makePilot(111, makeFlightPlan())]);
		await ensureFresh();
		expect(await getFlightPlan('111')).not.toBeNull();
		vi.setSystemTime(new Date(Date.now() + 30_000));
		fetchSpy.mockRejectedValueOnce(new Error('network down'));
		await ensureFresh();
		expect(await getFlightPlan('111')).not.toBeNull();
	});

	it('preserves the previous cache when the feed is malformed', async () => {
		const fetchSpy = mockFeed([makePilot(111, makeFlightPlan())]);
		await ensureFresh();
		vi.setSystemTime(new Date(Date.now() + 30_000));
		fetchSpy.mockResolvedValueOnce(
			new Response('not json', { status: 200, headers: { 'content-type': 'text/plain' } })
		);
		await ensureFresh();
		expect(await getFlightPlan('111')).not.toBeNull();
	});
});

describe('getFlightPlan', () => {
	it('returns null for unknown CIDs', async () => {
		mockFeed([makePilot(111, makeFlightPlan())]);
		expect(await getFlightPlan('999')).toBeNull();
	});

	it('returns the flight plan for a known CID', async () => {
		mockFeed([makePilot(111, makeFlightPlan({ departure: 'KIND', arrival: 'KCMH' }))]);
		const fp = await getFlightPlan('111');
		expect(fp).not.toBeNull();
		expect(fp!.departure).toBe('KIND');
		expect(fp!.arrival).toBe('KCMH');
	});

	it('returns null for a pilot present without a flight plan', async () => {
		mockFeed([makePilot(111, null)]);
		expect(await getFlightPlan('111')).toBeNull();
	});

	it('returns null after a refresh drops the pilot', async () => {
		const fetchSpy = mockFeed([makePilot(111, makeFlightPlan())]);
		await ensureFresh();
		expect(await getFlightPlan('111')).not.toBeNull();

		vi.setSystemTime(new Date(Date.now() + 30_000));
		fetchSpy.mockResolvedValueOnce(
			new Response(JSON.stringify({ pilots: [] }), {
				status: 200,
				headers: { 'content-type': 'application/json' }
			})
		);
		expect(await getFlightPlan('111')).toBeNull();
	});
});
