// test/online-controllers/domain.test.ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
	__resetCacheForTests,
	ensureFresh,
	getActiveSession,
	listByArtcc
} from '../../src/online-controllers/domain';
import type { OnlineController } from '../../src/online-controllers/types';

function makeController(overrides: Partial<OnlineController> = {}): OnlineController {
	return {
		artccId: 'ZID',
		primaryFacilityId: 'IND',
		primaryPositionId: 'TWR',
		role: 'controller',
		positions: [
			{
				facilityId: 'IND',
				facilityName: 'Indianapolis Tower',
				positionId: 'TWR',
				positionName: 'Tower',
				positionType: 'tower',
				radioName: 'Indianapolis Tower',
				defaultCallsign: 'IND_TWR',
				frequency: 120350000,
				isPrimary: true,
				isActive: true,
				callsign: 'IND_TWR'
			}
		],
		isActive: true,
		isObserver: false,
		loginTime: '2026-05-15T10:00:00Z',
		vatsimData: {
			cid: '1234567',
			realName: 'Test Controller',
			controllerInfo: '',
			userRating: 'S2',
			callsign: 'IND_TWR',
			loginTime: '2026-05-15T10:00:00Z'
		},
		...overrides
	};
}

function mockFetch(controllers: OnlineController[]) {
	return vi.spyOn(globalThis, 'fetch').mockResolvedValue(
		new Response(JSON.stringify({ controllers }), {
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
	it('fetches the feed and populates the cache on first call', async () => {
		const fetchSpy = mockFetch([
			makeController({ vatsimData: { ...makeController().vatsimData, cid: '111' } })
		]);
		await ensureFresh();
		expect(fetchSpy).toHaveBeenCalledTimes(1);
		expect(await getActiveSession('111')).not.toBeNull();
	});

	it('skips the fetch when cache is fresh (within TTL)', async () => {
		const fetchSpy = mockFetch([makeController()]);
		vi.setSystemTime(new Date(1_000_000));
		await ensureFresh();
		vi.setSystemTime(new Date(1_000_000 + 14_000)); // < 15s TTL
		await ensureFresh();
		expect(fetchSpy).toHaveBeenCalledTimes(1);
	});

	it('refetches when cache is stale (beyond TTL)', async () => {
		const fetchSpy = mockFetch([makeController()]);
		vi.setSystemTime(new Date(1_000_000));
		await ensureFresh();
		vi.setSystemTime(new Date(1_000_000 + 16_000)); // > 15s TTL
		await ensureFresh();
		expect(fetchSpy).toHaveBeenCalledTimes(2);
	});

	it('coalesces concurrent calls into one fetch (singleflight)', async () => {
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
		resolveBody(JSON.stringify({ controllers: [] }));
		await inflight;
		expect(fetchSpy).toHaveBeenCalledTimes(1);
	});

	it('preserves the previous cache when the fetch fails', async () => {
		const fetchSpy = mockFetch([
			makeController({ vatsimData: { ...makeController().vatsimData, cid: '111' } })
		]);
		await ensureFresh();
		expect(await getActiveSession('111')).not.toBeNull();

		// Move past the TTL, then mock fetch to throw.
		vi.setSystemTime(new Date(Date.now() + 30_000));
		fetchSpy.mockRejectedValueOnce(new Error('network down'));
		await ensureFresh();
		// Cache is preserved.
		expect(await getActiveSession('111')).not.toBeNull();
	});

	it('preserves the previous cache when the feed is malformed', async () => {
		const fetchSpy = mockFetch([
			makeController({ vatsimData: { ...makeController().vatsimData, cid: '111' } })
		]);
		await ensureFresh();
		vi.setSystemTime(new Date(Date.now() + 30_000));

		fetchSpy.mockResolvedValueOnce(
			new Response('not json', { status: 200, headers: { 'content-type': 'text/plain' } })
		);
		await ensureFresh();
		expect(await getActiveSession('111')).not.toBeNull();
	});
});

describe('getActiveSession', () => {
	it('returns null for unknown CIDs', async () => {
		mockFetch([makeController({ vatsimData: { ...makeController().vatsimData, cid: '111' } })]);
		expect(await getActiveSession('999')).toBeNull();
	});

	it('returns the controller record for a known CID', async () => {
		mockFetch([makeController({ vatsimData: { ...makeController().vatsimData, cid: '111' } })]);
		const c = await getActiveSession('111');
		expect(c).not.toBeNull();
		expect(c!.vatsimData.cid).toBe('111');
	});

	it('returns null after a refresh drops the CID', async () => {
		const fetchSpy = mockFetch([
			makeController({ vatsimData: { ...makeController().vatsimData, cid: '111' } })
		]);
		await ensureFresh();
		expect(await getActiveSession('111')).not.toBeNull();

		vi.setSystemTime(new Date(Date.now() + 30_000));
		fetchSpy.mockResolvedValueOnce(
			new Response(JSON.stringify({ controllers: [] }), {
				status: 200,
				headers: { 'content-type': 'application/json' }
			})
		);
		expect(await getActiveSession('111')).toBeNull();
	});
});

describe('listByArtcc', () => {
	it('returns only controllers in the given ARTCC', async () => {
		mockFetch([
			makeController({
				artccId: 'ZID',
				vatsimData: { ...makeController().vatsimData, cid: '111' }
			}),
			makeController({ artccId: 'ZAU', vatsimData: { ...makeController().vatsimData, cid: '222' } })
		]);
		const zid = await listByArtcc('ZID');
		expect(zid).toHaveLength(1);
		expect(zid[0]!.vatsimData.cid).toBe('111');
	});

	it('returns an empty array on cold cache + failed fetch', async () => {
		vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('network down'));
		expect(await listByArtcc('ZID')).toEqual([]);
	});
});
