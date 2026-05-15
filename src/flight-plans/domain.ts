// src/flight-plans/domain.ts
import { VatsimDataFeedSchema } from './schema';
import type { FlightPlan } from './types';

const TTL_MS = 15_000;
const FEED_URL = 'https://data.vatsim.net/v3/vatsim-data.json';

type Cache = { byCid: Map<string, FlightPlan>; fetchedAt: number };

let cache: Cache | null = null;
let inflight: Promise<void> | null = null;

async function fetchAndParse(): Promise<Map<string, FlightPlan> | null> {
	try {
		const res = await fetch(FEED_URL);
		if (!res.ok) {
			console.error(`[flight-plans] datafeed returned status ${res.status}`);
			return null;
		}
		const json = await res.json();
		const parsed = VatsimDataFeedSchema.safeParse(json);
		if (!parsed.success) {
			console.error('[flight-plans] datafeed failed schema validation', parsed.error.issues);
			return null;
		}
		const byCid = new Map<string, FlightPlan>();
		for (const p of parsed.data.pilots) {
			if (p.flight_plan) {
				byCid.set(String(p.cid), p.flight_plan);
			}
		}
		console.log(`[flight-plans] refreshed ${byCid.size} entries`);
		return byCid;
	} catch (err) {
		console.error('[flight-plans] datafeed fetch failed', err);
		return null;
	}
}

export async function ensureFresh(): Promise<void> {
	if (cache && Date.now() - cache.fetchedAt < TTL_MS) {
		return;
	}
	if (inflight) {
		return inflight;
	}
	inflight = (async () => {
		try {
			const fresh = await fetchAndParse();
			if (fresh) {
				cache = { byCid: fresh, fetchedAt: Date.now() };
			}
		} finally {
			inflight = null;
		}
	})();
	return inflight;
}

export async function getFlightPlan(cid: string): Promise<FlightPlan | null> {
	await ensureFresh();
	return cache?.byCid.get(cid) ?? null;
}

export function __resetCacheForTests(): void {
	cache = null;
	inflight = null;
}
