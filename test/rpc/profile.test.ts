import { env } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { makeDb } from '../../src/db/client';
import { users, sessions } from '../../src/db/schema';
import { upsertFromVatsim } from '../../src/domain/users';
import { makeVatsimProfile } from '../helpers/fixtures';

const fixedClock = (t: number) => ({ now: () => t });

beforeEach(async () => {
	const db = makeDb(env.DB);
	await db.delete(sessions);
	await db.delete(users);
});

describe('rpc/profile', () => {
	it('updates allowed profile fields and returns the new row', async () => {
		const db = makeDb(env.DB);
		const id = await upsertFromVatsim(db, makeVatsimProfile({ cid: '1' }), fixedClock(0));
		const got = await env.IDENTITY.updateProfile(id, {
			preferredName: 'Alex',
			pronouns: 'they/them',
			discordId: '12345'
		});
		expect(got.preferredName).toBe('Alex');
		expect(got.pronouns).toBe('they/them');
		expect(got.discordId).toBe('12345');

		const row = await db.select().from(users).where(eq(users.id, id)).get();
		expect(row?.preferredName).toBe('Alex');
	});

	it('null patch entries clear the field', async () => {
		const db = makeDb(env.DB);
		const id = await upsertFromVatsim(db, makeVatsimProfile({ cid: '1' }), fixedClock(0));
		await env.IDENTITY.updateProfile(id, { preferredName: 'Alex' });
		const got = await env.IDENTITY.updateProfile(id, { preferredName: null });
		expect(got.preferredName).toBeNull();
	});
});
