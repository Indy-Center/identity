import { feedCache } from '../feed-cache';
import { VatsimDataFeedSchema, type FlightPlan } from './schema';

const feed = feedCache(
	'flight-plans',
	'https://data.vatsim.net/v3/vatsim-data.json',
	VatsimDataFeedSchema,
	(data) => {
		const byCid = new Map<string, FlightPlan>();
		// Prefiles first, so a connected pilot's plan wins over an older prefile.
		for (const p of [...data.prefiles, ...data.pilots]) {
			if (p.flight_plan) {
				byCid.set(String(p.cid), p.flight_plan);
			}
		}
		return byCid;
	}
);

export const ensureFresh = feed.ensureFresh;
export const getFlightPlan = feed.get;
export const __resetCacheForTests = feed.reset;
