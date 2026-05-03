import { drizzle, type DrizzleD1Database } from 'drizzle-orm/d1';
import * as schema from './schema';

export type DB = DrizzleD1Database<typeof schema>;

// Identity-keyed cache of Drizzle wrappers. Cloudflare guarantees that
// a given binding (e.g. env.DB) is a stable object reference within an
// isolate, so the same binding hits the same wrapper across requests.
// WeakMap means unreachable bindings get collected automatically — no
// manual invalidation needed.
const cache = new WeakMap<D1Database, DB>();

export function makeDb(d1: D1Database): DB {
	let inst = cache.get(d1);
	if (!inst) {
		inst = drizzle(d1, { schema });
		cache.set(d1, inst);
	}
	return inst;
}
