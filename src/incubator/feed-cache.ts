import type { z } from 'zod';

const TTL_MS = 15_000;
// A hung upstream must not stall /oauth/userinfo; an abort degrades like any fetch error.
const FETCH_TIMEOUT_MS = 2_000;

/**
 * A per-isolate cache of a public JSON feed, indexed by CID. A failed refresh
 * keeps serving the last good copy; concurrent callers share one fetch.
 */
export function feedCache<S extends z.ZodType, T>(
	tag: string,
	url: string,
	schema: S,
	index: (data: z.infer<S>) => Map<string, T>
) {
	let cache: { byCid: Map<string, T>; fetchedAt: number } | null = null;
	let inflight: Promise<void> | null = null;

	async function refresh(): Promise<void> {
		try {
			const res = await fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
			if (!res.ok) {
				console.error(`[${tag}] feed returned status ${res.status}`);
				return;
			}
			const parsed = schema.safeParse(await res.json());
			if (!parsed.success) {
				console.error(`[${tag}] feed failed schema validation`, parsed.error.issues);
				return;
			}
			cache = { byCid: index(parsed.data), fetchedAt: Date.now() };
			console.log(`[${tag}] refreshed ${cache.byCid.size} entries`);
		} catch (err) {
			console.error(`[${tag}] feed fetch failed`, err);
		}
	}

	async function ensureFresh(): Promise<void> {
		if (cache && Date.now() - cache.fetchedAt < TTL_MS) {
			return;
		}
		inflight ??= refresh().finally(() => {
			inflight = null;
		});
		return inflight;
	}

	return {
		ensureFresh,
		async get(cid: string): Promise<T | null> {
			await ensureFresh();
			return cache?.byCid.get(cid) ?? null;
		},
		// Test-only hook for clearing the cache between runs.
		reset(): void {
			cache = null;
			inflight = null;
		}
	};
}
