import { env } from 'cloudflare:workers';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { makeDb } from '../../src/db';
import { users, sessions, userRoles } from '../../src/schema';
import {
	setAttributes,
	setUserActive,
	upsertFromVatsim,
	getById,
	getByCid,
	getByEmail,
	listAll,
	listByRole,
	listOperatingInitials
} from '../../src/users/domain';
import { createSession } from '../../src/sessions/domain';
import { IdentityError } from '../../src/client/errors';
import type { VatsimProfile } from '../../src/client/vatsim';

beforeEach(async () => {
	const db = makeDb(env.DB);
	await db.delete(sessions);
	await db.delete(userRoles);
	await db.delete(users);
});

afterEach(() => {
	vi.useRealTimers();
});

const seed: VatsimProfile = {
	cid: '999',
	personal: {
		name_first: 'Test',
		name_last: 'User',
		email: 'test@example.com'
	}
};

async function makeUser(): Promise<string> {
	const db = makeDb(env.DB);
	const u = await upsertFromVatsim(db, seed);
	return u.id;
}

describe('setAttributes — merge patch semantics', () => {
	it('absent keys preserve existing values', async () => {
		const id = await makeUser();
		const db = makeDb(env.DB);
		await setAttributes(db, id, { preferredName: 'Steve' });
		const after1 = await getById(db, id);
		expect(after1!.attributes.preferredName).toBe('Steve');

		await setAttributes(db, id, { pronouns: 'he/him' });
		const after2 = await getById(db, id);
		expect(after2!.attributes.preferredName).toBe('Steve'); // preserved
		expect(after2!.attributes.pronouns).toBe('he/him');
	});

	it('null deletes the key from attributes', async () => {
		const id = await makeUser();
		const db = makeDb(env.DB);
		await setAttributes(db, id, { preferredName: 'Steve', pronouns: 'he/him' });
		await setAttributes(db, id, { preferredName: null });
		const after = await getById(db, id);
		expect('preferredName' in after!.attributes).toBe(false);
		expect(after!.attributes.pronouns).toBe('he/him');
	});

	it('value overwrites existing', async () => {
		const id = await makeUser();
		const db = makeDb(env.DB);
		await setAttributes(db, id, { preferredName: 'Steve' });
		await setAttributes(db, id, { preferredName: 'Steven' });
		const after = await getById(db, id);
		expect(after!.attributes.preferredName).toBe('Steven');
	});

	it('catchall keys round-trip', async () => {
		const id = await makeUser();
		const db = makeDb(env.DB);
		await setAttributes(db, id, { 'community.profile': { color: 'blue' } });
		const after = await getById(db, id);
		expect(after!.attributes['community.profile']).toEqual({ color: 'blue' });
	});

	it('catchall key can be deleted with null', async () => {
		const id = await makeUser();
		const db = makeDb(env.DB);
		await setAttributes(db, id, { 'community.x': 1 });
		await setAttributes(db, id, { 'community.x': null });
		const after = await getById(db, id);
		expect('community.x' in after!.attributes).toBe(false);
	});

	it('throws not_found for missing user', async () => {
		const db = makeDb(env.DB);
		await expect(setAttributes(db, 'nonexistent', { preferredName: 'X' })).rejects.toThrow(
			IdentityError
		);
	});

	it('rejects invalid operating initials format', async () => {
		const id = await makeUser();
		const db = makeDb(env.DB);
		await expect(setAttributes(db, id, { operatingInitials: 'sc' })).rejects.toThrow();
		await expect(setAttributes(db, id, { operatingInitials: 'SCC' })).rejects.toThrow();
	});

	it('updates updatedAt timestamp', async () => {
		const id = await makeUser(); // upsert
		const db = makeDb(env.DB);
		vi.setSystemTime(new Date(5000));
		await setAttributes(db, id, { preferredName: 'Steve' });
		const after = await getById(db, id);
		expect(after!.updatedAt).toBe(5000);
	});

	it('recursively merges nested object values (RFC 7396)', async () => {
		const id = await makeUser();
		const db = makeDb(env.DB);

		// First write: nested object with two keys
		await setAttributes(db, id, {
			'community.profile': { color: 'blue', size: 'large' }
		});
		// Second write: only updates one nested key
		await setAttributes(db, id, {
			'community.profile': { color: 'red' }
		});

		const after = await getById(db, id);
		// 'size' is preserved, 'color' is updated
		expect(after!.attributes['community.profile']).toEqual({
			color: 'red',
			size: 'large'
		});
	});

	it('null in a nested key recursively deletes that key', async () => {
		const id = await makeUser();
		const db = makeDb(env.DB);

		await setAttributes(db, id, {
			'community.profile': { color: 'blue', size: 'large' }
		});
		await setAttributes(db, id, {
			'community.profile': { color: null }
		});

		const after = await getById(db, id);
		expect(after!.attributes['community.profile']).toEqual({ size: 'large' });
	});
});

describe('upsertFromVatsim', () => {
	it('inserts a new user with vatsimData populated and empty attributes', async () => {
		const db = makeDb(env.DB);
		vi.setSystemTime(new Date(1000));
		const { id } = await upsertFromVatsim(db, seed);
		const u = await getById(db, id);
		expect(u).toBeTruthy();
		expect(u!.cid).toBe('999');
		expect(u!.email).toBe('test@example.com');
		expect(u!.vatsimData).toMatchObject({ cid: '999' });
		expect(u!.attributes).toEqual({});
		expect(u!.isActive).toBe(true);
		expect(u!.createdAt).toBe(1000);
		expect(u!.updatedAt).toBe(1000);
	});

	it('does not re-enable a previously-disabled user on subsequent login', async () => {
		const db = makeDb(env.DB);
		const { id } = await upsertFromVatsim(db, seed);
		vi.setSystemTime(new Date(2000));
		await setUserActive(db, id, false, { reason: 'test', changedBy: 'admin' });
		const before = await getById(db, id);
		expect(before!.isActive).toBe(false);

		await upsertFromVatsim(db, seed);
		const after = await getById(db, id);
		expect(after!.isActive).toBe(false);
		// disabled* attribute keys preserved
		expect(after!.attributes.disabledReason).toBe('test');
		expect(after!.attributes.disabledAt).toBe(2000);
		expect(after!.attributes.disabledBy).toBe('admin');
	});

	it('on second login, updates vatsimData and email but preserves attributes', async () => {
		const db = makeDb(env.DB);
		vi.setSystemTime(new Date(1000));
		const { id } = await upsertFromVatsim(db, seed);
		await setAttributes(db, id, { preferredName: 'Steve', pronouns: 'he/him' });

		const seedV2: VatsimProfile = {
			cid: '999',
			personal: { name_first: 'Test', name_last: 'User', email: 'new@example.com' }
		};
		vi.setSystemTime(new Date(3000));
		await upsertFromVatsim(db, seedV2);
		const after = await getById(db, id);
		expect(after!.email).toBe('new@example.com');
		expect(after!.attributes.preferredName).toBe('Steve');
		expect(after!.attributes.pronouns).toBe('he/him');
		expect(after!.updatedAt).toBe(3000);
		expect(after!.createdAt).toBe(1000); // unchanged
	});

	it('returns the same user id for the same cid', async () => {
		const db = makeDb(env.DB);
		const { id: id1 } = await upsertFromVatsim(db, seed);
		const { id: id2 } = await upsertFromVatsim(db, seed);
		expect(id2).toBe(id1);
	});
});

describe('reads', () => {
	it('getById returns null for missing user', async () => {
		const db = makeDb(env.DB);
		expect(await getById(db, 'missing')).toBeNull();
	});

	it('getByCid returns the user', async () => {
		const db = makeDb(env.DB);
		const { id } = await upsertFromVatsim(db, seed);
		const u = await getByCid(db, '999');
		expect(u!.id).toBe(id);
	});

	it('getByEmail returns array (non-unique)', async () => {
		const db = makeDb(env.DB);
		await upsertFromVatsim(db, seed);
		await upsertFromVatsim(db, { ...seed, cid: '1000' }); // same email, different cid
		const list = await getByEmail(db, 'test@example.com');
		expect(list.length).toBe(2);
	});

	it('listAll returns all users', async () => {
		const db = makeDb(env.DB);
		await upsertFromVatsim(db, seed);
		expect((await listAll(db)).length).toBe(1);
	});

	it('listByRole returns users with that role', async () => {
		const db = makeDb(env.DB);
		const { id } = await upsertFromVatsim(db, seed);
		await db
			.insert(userRoles)
			.values({ userId: id, role: 'admin', grantedAt: 1000, grantedBy: null });
		const list = await listByRole(db, 'admin');
		expect(list.length).toBe(1);
		expect(list[0]?.id).toBe(id);
	});
});

describe('listOperatingInitials', () => {
	it('returns OIs from attributes JSON, deduped', async () => {
		const db = makeDb(env.DB);
		const { id: id1 } = await upsertFromVatsim(db, seed);
		const { id: id2 } = await upsertFromVatsim(db, { ...seed, cid: '1000' });
		await setAttributes(db, id1, { operatingInitials: 'SC' });
		await setAttributes(db, id2, { operatingInitials: 'XY' });
		const list = await listOperatingInitials(db);
		expect(list.sort()).toEqual(['SC', 'XY']);
	});

	it('skips users without an OI set', async () => {
		const db = makeDb(env.DB);
		await upsertFromVatsim(db, seed);
		const list = await listOperatingInitials(db);
		expect(list).toEqual([]);
	});
});

describe('setUserActive', () => {
	it('disables an active user, writes disabled* attributes, kills sessions', async () => {
		const db = makeDb(env.DB);
		const id = await makeUser();
		await createSession(db, id);
		await createSession(db, id);
		const sessionsBefore = await db.select().from(sessions).all();
		expect(sessionsBefore.length).toBe(2);

		vi.setSystemTime(new Date(2000));
		const updated = await setUserActive(db, id, false, {
			reason: 'spam',
			changedBy: 'admin-cid'
		});
		expect(updated.isActive).toBe(false);
		expect(updated.attributes.disabledReason).toBe('spam');
		expect(updated.attributes.disabledAt).toBe(2000);
		expect(updated.attributes.disabledBy).toBe('admin-cid');
		expect(updated.updatedAt).toBe(2000);

		const persisted = await getById(db, id);
		expect(persisted!.isActive).toBe(false);
		expect(persisted!.attributes.disabledReason).toBe('spam');
		expect(persisted!.attributes.disabledAt).toBe(2000);
		expect(persisted!.attributes.disabledBy).toBe('admin-cid');

		const sessionsAfter = await db.select().from(sessions).all();
		expect(sessionsAfter.length).toBe(0);
	});

	it('disables without opts: only disabledAt is written', async () => {
		const db = makeDb(env.DB);
		const id = await makeUser();
		vi.setSystemTime(new Date(2500));
		const updated = await setUserActive(db, id, false);
		expect(updated.isActive).toBe(false);
		expect(updated.attributes.disabledAt).toBe(2500);
		expect('disabledReason' in updated.attributes).toBe(false);
		expect('disabledBy' in updated.attributes).toBe(false);
	});

	it('enables a disabled user, clears disabled* attributes', async () => {
		const db = makeDb(env.DB);
		const id = await makeUser();
		await setUserActive(db, id, false, { reason: 'spam', changedBy: 'admin' });

		vi.setSystemTime(new Date(3000));
		const updated = await setUserActive(db, id, true);
		expect(updated.isActive).toBe(true);
		expect('disabledReason' in updated.attributes).toBe(false);
		expect('disabledAt' in updated.attributes).toBe(false);
		expect('disabledBy' in updated.attributes).toBe(false);
		expect(updated.updatedAt).toBe(3000);

		const persisted = await getById(db, id);
		expect(persisted!.isActive).toBe(true);
		expect('disabledReason' in persisted!.attributes).toBe(false);
		expect('disabledAt' in persisted!.attributes).toBe(false);
		expect('disabledBy' in persisted!.attributes).toBe(false);
	});

	it('preserves unrelated attribute keys when toggling active', async () => {
		const db = makeDb(env.DB);
		const id = await makeUser();
		await setAttributes(db, id, { preferredName: 'Steve', pronouns: 'he/him' });

		await setUserActive(db, id, false, { reason: 'x' });
		const disabled = await getById(db, id);
		expect(disabled!.attributes.preferredName).toBe('Steve');
		expect(disabled!.attributes.pronouns).toBe('he/him');

		await setUserActive(db, id, true);
		const reenabled = await getById(db, id);
		expect(reenabled!.attributes.preferredName).toBe('Steve');
		expect(reenabled!.attributes.pronouns).toBe('he/him');
	});

	it('throws not_found for missing user', async () => {
		const db = makeDb(env.DB);
		await expect(setUserActive(db, 'nonexistent', false)).rejects.toThrow(IdentityError);
	});

	it('updates updatedAt timestamp', async () => {
		const db = makeDb(env.DB);
		const id = await makeUser();
		vi.setSystemTime(new Date(4242));
		await setUserActive(db, id, false);
		const u = await getById(db, id);
		expect(u!.updatedAt).toBe(4242);
	});
});
