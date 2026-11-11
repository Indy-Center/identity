import { feedCache } from '../feed-cache';
import { VnasControllerResponseSchema, type OnlineController } from './schema';

const feed = feedCache(
	'presence',
	'https://live.env.vnas.vatsim.net/data-feed/controllers.json',
	VnasControllerResponseSchema,
	(data) => new Map<string, OnlineController>(data.controllers.map((c) => [c.vatsimData.cid, c]))
);

export const ensureFresh = feed.ensureFresh;
export const getActiveSession = feed.get;
export const __resetCacheForTests = feed.reset;
