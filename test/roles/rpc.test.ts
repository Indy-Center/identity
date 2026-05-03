import { env } from 'cloudflare:workers';
import { beforeEach, describe, expect, it } from 'vitest';
import { makeDb } from '../../src/db';
import { users, userRoles, sessions } from '../../src/schema';
import { upsertFromVatsim } from '../../src/users/domain';
import { makeVatsimProfile } from '../helpers/fixtures';

beforeEach(async () => {
	const db = makeDb(env.DB);
	await db.delete(userRoles);
	await db.delete(sessions);
	await db.delete(users);
});

async function seed(): Promise<string> {
	const db = makeDb(env.DB);
	const u = await upsertFromVatsim(db, makeVatsimProfile({ cid: '1' }));
	return u.id;
}

describe('rpc/roles', () => {
	it('addRole + getRoles round-trips, ignoring duplicates', async () => {
		const id = await seed();
		await env.IDENTITY.addRole(id, 'zid:admin');
		await env.IDENTITY.addRole(id, 'zid:admin');
		expect((await env.IDENTITY.getRoles(id)).sort()).toEqual(['zid:admin']);
	});

	it('addRole records grantedBy when provided', async () => {
		const id = await seed();
		await env.IDENTITY.addRole(id, 'r', { grantedBy: 'community-website:vatusa-sync' });
		const db = makeDb(env.DB);
		const row = await db.select().from(userRoles).all();
		expect(row[0]?.grantedBy).toBe('community-website:vatusa-sync');
	});

	it('removeRole deletes the row', async () => {
		const id = await seed();
		await env.IDENTITY.addRole(id, 'r');
		await env.IDENTITY.removeRole(id, 'r');
		expect(await env.IDENTITY.getRoles(id)).toEqual([]);
	});

	it('setRoles replaces the full list', async () => {
		const id = await seed();
		await env.IDENTITY.addRole(id, 'a');
		await env.IDENTITY.addRole(id, 'b');
		await env.IDENTITY.setRoles(id, ['c', 'd'], { grantedBy: 'test' });
		expect((await env.IDENTITY.getRoles(id)).sort()).toEqual(['c', 'd']);
	});
});
