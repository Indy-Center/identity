import { env } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';
import { makeDb } from '../../src/db/client';
import { users, userRoles, sessions } from '../../src/db/schema';
import { upsertFromVatsim } from '../../src/domain/users';
import { makeVatsimProfile } from '../helpers/fixtures';

const fixedClock = (t: number) => ({ now: () => t });

beforeEach(async () => {
	const db = makeDb(env.DB);
	await db.delete(userRoles);
	await db.delete(sessions);
	await db.delete(users);
});

describe('rpc/users', () => {
	it('getUserByCid returns the user or null', async () => {
		const db = makeDb(env.DB);
		const id = await upsertFromVatsim(db, makeVatsimProfile({ cid: '1' }), fixedClock(0));
		const found = (await env.IDENTITY.getUserByCid('1')) as { id: string };
		expect(found.id).toBe(id);
		expect(await env.IDENTITY.getUserByCid('nope')).toBeNull();
	});

	it('getUserById returns the user or null', async () => {
		const db = makeDb(env.DB);
		const id = await upsertFromVatsim(db, makeVatsimProfile({ cid: '1' }), fixedClock(0));
		const got = (await env.IDENTITY.getUserById(id)) as { cid: string };
		expect(got.cid).toBe('1');
		expect(await env.IDENTITY.getUserById('nope')).toBeNull();
	});

	it('listUsersByRole returns users matching the role', async () => {
		const db = makeDb(env.DB);
		const id = await upsertFromVatsim(db, makeVatsimProfile({ cid: '1' }), fixedClock(0));
		await db.insert(userRoles).values({ userId: id, role: 'zid:admin', grantedAt: 0 });
		const list = (await env.IDENTITY.listUsersByRole('zid:admin')) as Array<{ cid: string }>;
		expect(list).toHaveLength(1);
		expect(list[0]?.cid).toBe('1');
	});
});
