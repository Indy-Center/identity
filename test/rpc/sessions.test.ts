import { env } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';
import { makeDb } from '../../src/db/client';
import { users, sessions, userRoles } from '../../src/db/schema';
import { upsertFromVatsim } from '../../src/domain/users';
import { createSession } from '../../src/domain/session';
import { makeVatsimProfile } from '../helpers/fixtures';

const fixedClock = (t: number) => ({ now: () => t });

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
		const now = Date.now();
		const userId = await upsertFromVatsim(db, makeVatsimProfile({ cid: '1' }), { now: () => now });
		const { token } = await createSession(db, userId, { now: () => now });
		await db.insert(userRoles).values({ userId, role: 'zid:admin', grantedAt: now });

		const payload = await env.IDENTITY.validateSession(token);
		expect(payload).not.toBeNull();
		expect(payload!.userId).toBe(userId);
		expect(payload!.roles).toEqual(['zid:admin']);
	});

	it('invalidateSession deletes the row', async () => {
		const db = makeDb(env.DB);
		const userId = await upsertFromVatsim(db, makeVatsimProfile({ cid: '1' }), fixedClock(0));
		const { token } = await createSession(db, userId, fixedClock(0));
		await env.IDENTITY.invalidateSession(token);
		expect(await db.select().from(sessions).all()).toHaveLength(0);
	});

	it('invalidateUserSessions deletes all sessions for a user', async () => {
		const db = makeDb(env.DB);
		const userId = await upsertFromVatsim(db, makeVatsimProfile({ cid: '1' }), fixedClock(0));
		await createSession(db, userId, fixedClock(0));
		await createSession(db, userId, fixedClock(0));
		await env.IDENTITY.invalidateUserSessions(userId);
		expect(await db.select().from(sessions).all()).toHaveLength(0);
	});
});
