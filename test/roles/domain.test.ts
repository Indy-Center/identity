import { env } from 'cloudflare:workers';
import { beforeEach, describe, expect, it } from 'vitest';
import { makeDb } from '../../src/db';
import { users, userRoles } from '../../src/schema';
import { upsertFromVatsim } from '../../src/users/domain';
import { add, remove, set, get } from '../../src/roles/domain';
import { makeVatsimProfile } from '../helpers/fixtures';

beforeEach(async () => {
	const db = makeDb(env.DB);
	await db.delete(userRoles);
	await db.delete(users);
});

async function seed(cid = '1'): Promise<string> {
	const db = makeDb(env.DB);
	const u = await upsertFromVatsim(db, makeVatsimProfile({ cid }));
	return u.id;
}

describe('add', () => {
	it('adds a role and get returns it', async () => {
		const db = makeDb(env.DB);
		const id = await seed();
		await add(db, id, 'zid:admin');
		expect(await get(db, id)).toEqual(['zid:admin']);
	});

	it('is idempotent — calling twice yields one row', async () => {
		const db = makeDb(env.DB);
		const id = await seed();
		await add(db, id, 'zid:admin');
		await add(db, id, 'zid:admin');
		const rows = await db.select().from(userRoles).all();
		expect(rows).toHaveLength(1);
	});

	it('records grantedBy when supplied', async () => {
		const db = makeDb(env.DB);
		const id = await seed();
		await add(db, id, 'r', { grantedBy: 'community-website:vatusa-sync' });
		const rows = await db.select().from(userRoles).all();
		expect(rows[0]?.grantedBy).toBe('community-website:vatusa-sync');
	});

	it('records null grantedBy when omitted', async () => {
		const db = makeDb(env.DB);
		const id = await seed();
		await add(db, id, 'r');
		const rows = await db.select().from(userRoles).all();
		expect(rows[0]?.grantedBy).toBeNull();
	});
});

describe('remove', () => {
	it('deletes the matching row', async () => {
		const db = makeDb(env.DB);
		const id = await seed();
		await add(db, id, 'r');
		await remove(db, id, 'r');
		expect(await get(db, id)).toEqual([]);
	});

	it('is a no-op for a role the user does not have', async () => {
		const db = makeDb(env.DB);
		const id = await seed();
		await add(db, id, 'r');
		await remove(db, id, 'other');
		expect(await get(db, id)).toEqual(['r']);
	});
});

describe('set', () => {
	it('replaces the full role list', async () => {
		const db = makeDb(env.DB);
		const id = await seed();
		await add(db, id, 'a');
		await add(db, id, 'b');
		await set(db, id, ['c', 'd']);
		expect((await get(db, id)).sort()).toEqual(['c', 'd']);
	});

	it('set([]) deletes all roles for the user', async () => {
		const db = makeDb(env.DB);
		const id = await seed();
		await add(db, id, 'a');
		await add(db, id, 'b');
		await set(db, id, []);
		expect(await get(db, id)).toEqual([]);
	});

	it("does not affect other users' roles", async () => {
		const db = makeDb(env.DB);
		const id1 = await seed('1');
		const id2 = await seed('2');
		await add(db, id1, 'a');
		await add(db, id2, 'x');
		await add(db, id2, 'y');
		await set(db, id1, ['c', 'd']);
		expect((await get(db, id2)).sort()).toEqual(['x', 'y']);
	});
});

describe('get', () => {
	it('returns [] for a user with no roles', async () => {
		const db = makeDb(env.DB);
		const id = await seed();
		expect(await get(db, id)).toEqual([]);
	});
});
