import { env } from 'cloudflare:workers';
import { describe, expect, it } from 'vitest';
import { makeDb } from '../src/db';
import { users } from '../src/schema';

describe('users table', () => {
	it('insert and select round-trips', async () => {
		const db = makeDb(env.DB);
		await db.insert(users).values({
			id: 'u1',
			cid: '1234567',
			email: 'a@b.com',
			vatsimData: {
				cid: '1234567',
				personal: { name_first: 'A', name_last: 'B', email: 'a@b.com' }
			},
			attributes: {},
			createdAt: 1000,
			updatedAt: 1000
		});
		const got = await db.select().from(users).all();
		expect(got).toHaveLength(1);
		expect(got[0]?.cid).toBe('1234567');
	});
});
