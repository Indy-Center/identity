import { env } from 'cloudflare:workers';
import { beforeEach, describe, expect, it } from 'vitest';
import { makeDb } from '../../src/db';
import { sessions, userRoles, users } from '../../src/schema';
import {
	getUser,
	listUsers,
	setUserActive,
	updateProfile,
	upsertFromVatsim
} from '../../src/users/domain';
import { createSession } from '../../src/sessions/domain';
import { makeVatsimProfile } from '../helpers/fixtures';

const db = () => makeDb(env.DB);

beforeEach(async () => {
	await db().delete(userRoles);
	await db().delete(sessions);
	await db().delete(users);
});

describe('upsertFromVatsim', () => {
	it('creates a user keyed by cid with the VATSIM columns filled', async () => {
		const user = await upsertFromVatsim(
			db(),
			makeVatsimProfile({
				cid: '42',
				vatsim: {
					rating: { id: 5, short: 'C1' },
					pilotrating: { id: 1, short: 'P1' },
					division: { id: 'USA' },
					region: { id: 'AMAS' },
					subdivision: { id: null }
				}
			})
		);
		expect(user).toMatchObject({
			cid: '42',
			firstName: 'Test',
			lastName: 'User',
			email: 'test@example.com',
			rating: 'C1',
			pilotRating: 'P1',
			division: 'USA',
			region: 'AMAS',
			subdivision: null,
			active: true
		});
		expect(user.vatsimProfile.cid).toBe('42');
	});

	it('overwrites VATSIM columns and leaves identity-owned columns alone', async () => {
		await upsertFromVatsim(db(), makeVatsimProfile({ cid: '42' }));
		await updateProfile(db(), '42', {
			preferredName: 'Pat Q',
			pronouns: 'they/them',
			operatingInitials: 'PQ',
			discordId: '123456789012345678'
		});
		const again = await upsertFromVatsim(
			db(),
			makeVatsimProfile({
				cid: '42',
				personal: { name_first: 'New', name_last: 'Name', email: 'new@example.com' }
			})
		);
		expect(again).toMatchObject({
			firstName: 'New',
			email: 'new@example.com',
			preferredName: 'Pat Q',
			pronouns: 'they/them',
			operatingInitials: 'PQ',
			discordId: '123456789012345678',
			active: true
		});
	});
});

describe('updateProfile', () => {
	it('clears a field with null and ignores undefined', async () => {
		await upsertFromVatsim(db(), makeVatsimProfile({ cid: '1' }));
		await updateProfile(db(), '1', { preferredName: 'A', pronouns: 'she/her' });
		const user = await updateProfile(db(), '1', { preferredName: null });
		expect(user.preferredName).toBeNull();
		expect(user.pronouns).toBe('she/her');
	});

	it('throws not_found for an unknown cid', async () => {
		await expect(updateProfile(db(), 'nope', { pronouns: 'x' })).rejects.toMatchObject({
			code: 'not_found',
			status: 404
		});
	});

	it('throws conflict for a discord id another user holds', async () => {
		await upsertFromVatsim(db(), makeVatsimProfile({ cid: '1' }));
		await upsertFromVatsim(db(), makeVatsimProfile({ cid: '2' }));
		await updateProfile(db(), '1', { discordId: '111111111111111111' });
		await expect(
			updateProfile(db(), '2', { discordId: '111111111111111111' })
		).rejects.toMatchObject({ code: 'conflict', status: 409 });
	});
});

describe('listUsers', () => {
	it('filters by role (distinct across sources) and by discord id', async () => {
		await upsertFromVatsim(db(), makeVatsimProfile({ cid: '1' }));
		await upsertFromVatsim(db(), makeVatsimProfile({ cid: '2' }));
		await db()
			.insert(userRoles)
			.values([
				{ cid: '1', role: 'community:admin', source: 'a', grantedAt: 1 },
				{ cid: '1', role: 'community:admin', source: 'b', grantedAt: 1 }
			]);
		await updateProfile(db(), '2', { discordId: '222222222222222222' });
		expect((await listUsers(db(), { role: 'community:admin' })).map((u) => u.cid)).toEqual(['1']);
		expect((await listUsers(db(), { discordId: '222222222222222222' })).map((u) => u.cid)).toEqual([
			'2'
		]);
	});
});

describe('setUserActive', () => {
	it('disabling records the reason and deletes sessions; enabling clears it', async () => {
		await upsertFromVatsim(db(), makeVatsimProfile({ cid: '1' }));
		await createSession(db(), '1');
		const disabled = await setUserActive(db(), '1', false, { reason: 'spam' });
		expect(disabled).toMatchObject({ active: false, disabledReason: 'spam' });
		expect(await db().select().from(sessions).all()).toHaveLength(0);
		const enabled = await setUserActive(db(), '1', true);
		expect(enabled).toMatchObject({ active: true, disabledReason: null, disabledAt: null });
		expect((await getUser(db(), '1'))?.active).toBe(true);
	});
});
