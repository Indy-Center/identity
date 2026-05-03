import { env } from 'cloudflare:workers';
import { beforeEach, describe, expect, it } from 'vitest';
import { makeDb } from '../../src/db';
import { users, userRoles, sessions } from '../../src/schema';
import { setAttributes, upsertFromVatsim } from '../../src/users/domain';
import { makeVatsimProfile } from '../helpers/fixtures';

beforeEach(async () => {
	const db = makeDb(env.DB);
	await db.delete(userRoles);
	await db.delete(sessions);
	await db.delete(users);
});

describe('rpc/users', () => {
	it('getUserByCid returns the user or null', async () => {
		const db = makeDb(env.DB);
		const { id } = await upsertFromVatsim(db, makeVatsimProfile({ cid: '1' }));
		const found = (await env.IDENTITY.getUserByCid('1')) as { id: string } | null;
		expect(found?.id).toBe(id);
		expect(await env.IDENTITY.getUserByCid('nope')).toBeNull();
	});

	it('getUserById returns the user or null', async () => {
		const db = makeDb(env.DB);
		const { id } = await upsertFromVatsim(db, makeVatsimProfile({ cid: '1' }));
		const got = (await env.IDENTITY.getUserById(id)) as { cid: string } | null;
		expect(got?.cid).toBe('1');
		expect(await env.IDENTITY.getUserById('nope')).toBeNull();
	});

	it('listUsersByRole returns users matching the role', async () => {
		const db = makeDb(env.DB);
		const { id } = await upsertFromVatsim(db, makeVatsimProfile({ cid: '1' }));
		await db.insert(userRoles).values({ userId: id, role: 'zid:admin', grantedAt: 0 });
		const list = (await env.IDENTITY.listUsersByRole('zid:admin')) as Array<{ cid: string }>;
		expect(list).toHaveLength(1);
		expect(list[0]?.cid).toBe('1');
	});

	it('listUsers returns all users', async () => {
		const db = makeDb(env.DB);
		await upsertFromVatsim(db, makeVatsimProfile({ cid: '1000001' }));
		await upsertFromVatsim(db, makeVatsimProfile({ cid: '1000002' }));
		const result = (await env.IDENTITY.listUsers()) as Array<{ cid: string }>;
		expect(result).toHaveLength(2);
		expect(result.map((u) => u.cid).sort()).toEqual(['1000001', '1000002']);
	});

	it('listUsers returns empty array when no users', async () => {
		const result = await env.IDENTITY.listUsers();
		expect(result).toEqual([]);
	});

	it('listOperatingInitials returns only set values', async () => {
		const db = makeDb(env.DB);
		const { id: id1 } = await upsertFromVatsim(db, makeVatsimProfile({ cid: '2000001' }));
		const { id: id2 } = await upsertFromVatsim(db, makeVatsimProfile({ cid: '2000002' }));
		await upsertFromVatsim(db, makeVatsimProfile({ cid: '2000003' }));
		await setAttributes(db, id1, { operatingInitials: 'XA' });
		await setAttributes(db, id2, { operatingInitials: 'XB' });
		// user 3 has no operatingInitials — should not appear

		const taken = await env.IDENTITY.listOperatingInitials();
		expect(taken.sort()).toEqual(['XA', 'XB']);
	});

	it('listOperatingInitials returns empty array when no operating initials are set', async () => {
		const db = makeDb(env.DB);
		await upsertFromVatsim(db, makeVatsimProfile({ cid: '2000004' }));
		const taken = await env.IDENTITY.listOperatingInitials();
		expect(taken).toEqual([]);
	});
});
