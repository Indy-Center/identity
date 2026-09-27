import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import { makeDb } from '../src/db';
import { users } from '../src/schema';

describe('users table', () => {
	it('is keyed by cid', async () => {
		const db = makeDb(env.DB);
		await db.delete(users);
		await db.insert(users).values({
			cid: '1234567',
			email: 'a@b.com',
			vatsimProfile: { cid: '1234567', personal: { email: 'a@b.com' } },
			vatsimSyncedAt: 1000,
			createdAt: 1000,
			updatedAt: 1000
		});
		const got = await db.select().from(users).all();
		expect(got).toHaveLength(1);
		expect(got[0]).toMatchObject({ cid: '1234567', active: true, preferredName: null });
	});
});
