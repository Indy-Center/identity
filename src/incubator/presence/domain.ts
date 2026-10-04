import { VnasControllerResponseSchema } from './schema';
import type { OnlineController } from './types';

const TTL_MS = 15_000;
// A hung upstream must not stall /oauth/userinfo; an abort degrades like any fetch error.
const FETCH_TIMEOUT_MS = 2_000;
const FEED_URL = 'https://live.env.vnas.vatsim.net/data-feed/controllers.json';

type Cache = { byCid: Map<string, OnlineController>; fetchedAt: number };

let cache: Cache | null = null;
let inflight: Promise<void> | null = null;

async function fetchAndParse(): Promise<Map<string, OnlineController> | null> {
	try {
		const res = await fetch(FEED_URL, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
		if (!res.ok) {
			console.error(`[presence] feed returned status ${res.status}`);
			return null;
		}
		const json = await res.json();
		const parsed = VnasControllerResponseSchema.safeParse(json);
		if (!parsed.success) {
			console.error('[presence] feed failed schema validation', parsed.error.issues);
			return null;
		}
		const byCid = new Map<string, OnlineController>();
		for (const c of parsed.data.controllers) {
			byCid.set(c.vatsimData.cid, c);
		}
		console.log(`[presence] refreshed ${byCid.size} entries`);
		return byCid;
	} catch (err) {
		console.error('[presence] feed fetch failed', err);
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

export async function getActiveSession(cid: string): Promise<OnlineController | null> {
	await ensureFresh();
	return cache?.byCid.get(cid) ?? null;
}

// Test-only hook for clearing the module-scoped cache between runs.
export function __resetCacheForTests(): void {
	cache = null;
	inflight = null;
}
