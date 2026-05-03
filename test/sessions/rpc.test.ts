import { env } from 'cloudflare:workers';
import { beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { makeDb } from '../../src/db';
import { users, sessions, userRoles } from '../../src/schema';
import { upsertFromVatsim } from '../../src/users/domain';
import { createSession } from '../../src/sessions/domain';
import { makeVatsimProfile } from '../helpers/fixtures';

beforeEach(async () => {
	const db = makeDb(env.DB);
	await db.delete(userRoles);
	await db.delete(sessions);
	await db.delete(users);
});

describe('rpc/sessions', () => {
	it('validateSession returns null for unknown tokens', async () => {
		expect(await env.IDENTITY.validateSession('nope')).toBeNull();
	});

	it('validateSession returns userId and roles', async () => {
		const db = makeDb(env.DB);
		const { id: userId } = await upsertFromVatsim(db, makeVatsimProfile({ cid: '1' }));
		const { token } = await createSession(db, userId);
		await db.insert(userRoles).values({ userId, role: 'zid:admin', grantedAt: Date.now() });

		const payload = await env.IDENTITY.validateSession(token);
		expect(payload).not.toBeNull();
		expect(payload!.userId).toBe(userId);
		expect(payload!.roles).toEqual(['zid:admin']);
	});

	it('validateSession returns null when the user has been disabled', async () => {
		const db = makeDb(env.DB);
		const { id: userId } = await upsertFromVatsim(db, makeVatsimProfile({ cid: '1' }));
		const { token } = await createSession(db, userId);
		// Bypass setUserActive (which deletes sessions atomically) so we hit the
		// orphan-session path validateSession defends against.
		await db.update(users).set({ isActive: false }).where(eq(users.id, userId));
		expect(await env.IDENTITY.validateSession(token)).toBeNull();
	});

	it('getCurrentUser returns the user for a valid token', async () => {
		const db = makeDb(env.DB);
		const { id: userId } = await upsertFromVatsim(db, makeVatsimProfile({ cid: '7' }));
		const { token } = await createSession(db, userId);

		const user = await env.IDENTITY.getCurrentUser(token);
		expect(user).not.toBeNull();
		expect(user!.id).toBe(userId);
		expect(user!.cid).toBe('7');
	});

	it('getCurrentUser returns null for an unknown token', async () => {
		expect(await env.IDENTITY.getCurrentUser('nope')).toBeNull();
	});

	it('getCurrentUser returns null after the session is invalidated', async () => {
		const db = makeDb(env.DB);
		const { id: userId } = await upsertFromVatsim(db, makeVatsimProfile({ cid: '8' }));
		const { token } = await createSession(db, userId);
		await env.IDENTITY.invalidateSession(token);
		expect(await env.IDENTITY.getCurrentUser(token)).toBeNull();
	});

	it('invalidateSession deletes the row', async () => {
		const db = makeDb(env.DB);
		const { id: userId } = await upsertFromVatsim(db, makeVatsimProfile({ cid: '1' }));
		const { token } = await createSession(db, userId);
		await env.IDENTITY.invalidateSession(token);
		expect(await db.select().from(sessions).all()).toHaveLength(0);
	});

	it('invalidateUserSessions deletes all sessions for a user', async () => {
		const db = makeDb(env.DB);
		const { id: userId } = await upsertFromVatsim(db, makeVatsimProfile({ cid: '1' }));
		await createSession(db, userId);
		await createSession(db, userId);
		await env.IDENTITY.invalidateUserSessions(userId);
		expect(await db.select().from(sessions).all()).toHaveLength(0);
	});
});
