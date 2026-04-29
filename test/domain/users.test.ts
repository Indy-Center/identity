import { env } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { makeDb } from '../../src/db/client';
import { users } from '../../src/db/schema';
import { upsertFromVatsim } from '../../src/domain/users';
import { makeVatsimProfile } from '../helpers/fixtures';

const fixedClock = (t: number) => ({ now: () => t });

beforeEach(async () => {
	const db = makeDb(env.DB);
	await db.delete(users);
});

describe('upsertFromVatsim', () => {
	it('inserts a new user and returns the generated id', async () => {
		const db = makeDb(env.DB);
		const profile = makeVatsimProfile({ cid: '999' });
		const id = await upsertFromVatsim(db, profile, fixedClock(1000));
		expect(id).toMatch(/^[0-9a-f-]{36}$/i);
		const got = await db.select().from(users).where(eq(users.id, id)).get();
		expect(got?.cid).toBe('999');
		expect(got?.firstName).toBe('Test');
		expect(got?.email).toBe('test@example.com');
		expect(got?.createdAt).toBe(1000);
		expect(got?.updatedAt).toBe(1000);
		expect(JSON.parse(got!.vatsimData).cid).toBe('999');
	});

	it('updates existing user when CID matches and preserves id + created_at', async () => {
		const db = makeDb(env.DB);
		const original = makeVatsimProfile({ cid: '999' });
		const id = await upsertFromVatsim(db, original, fixedClock(1000));

		const updated = makeVatsimProfile({
			cid: '999',
			personal: { name_first: 'New', name_last: 'Name', email: 'new@example.com' }
		});
		const id2 = await upsertFromVatsim(db, updated, fixedClock(2000));
		expect(id2).toBe(id);

		const got = await db.select().from(users).where(eq(users.id, id)).get();
		expect(got?.firstName).toBe('New');
		expect(got?.email).toBe('new@example.com');
		expect(got?.createdAt).toBe(1000);
		expect(got?.updatedAt).toBe(2000);
	});
});
