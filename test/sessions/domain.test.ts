import { env } from 'cloudflare:workers';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { makeDb } from '../../src/db';
import { users, sessions } from '../../src/schema';
import { createSession, findSessionByToken, validateSession } from '../../src/sessions/domain';
import { upsertFromVatsim } from '../../src/users/domain';
import { makeVatsimProfile } from '../helpers/fixtures';

async function seedUser(db: ReturnType<typeof makeDb>, cid = 'u1') {
	await upsertFromVatsim(db, makeVatsimProfile({ cid }));
}

beforeEach(async () => {
	const db = makeDb(env.DB);
	await db.delete(sessions);
	await db.delete(users);
});

afterEach(() => {
	vi.useRealTimers();
});

describe('createSession', () => {
	it('sweeps expired sessions, keeping live ones', async () => {
		const db = makeDb(env.DB);
		await seedUser(db);
		const row = { cid: 'u1', createdAt: 1, lastSeenAt: 1 };
		await db.insert(sessions).values([
			{ ...row, id: 'expired', expiresAt: Date.now() - 1 },
			{ ...row, id: 'live', expiresAt: Date.now() + 60_000 }
		]);
		await createSession(db, 'u1');
		const ids = (await db.select({ id: sessions.id }).from(sessions).all()).map((s) => s.id);
		expect(ids).toHaveLength(2);
		expect(ids).toContain('live');
		expect(ids).not.toContain('expired');
	});

	it('inserts a row keyed by sha256(token), returns raw token', async () => {
		const db = makeDb(env.DB);
		await seedUser(db);
		vi.setSystemTime(new Date(1000));
		const { token, expiresAt } = await createSession(db, 'u1');
		expect(token).toMatch(/^[a-z2-7]{32}$/);
		expect(expiresAt).toBe(1000 + 30 * 24 * 60 * 60 * 1000);
		const rows = await db.select().from(sessions).all();
		expect(rows).toHaveLength(1);
		expect(rows[0]?.cid).toBe('u1');
		expect(rows[0]?.id).not.toBe(token); // stored as hash, not raw
		expect(rows[0]?.id).toMatch(/^[0-9a-f]{64}$/);
	});
});

describe('findSessionByToken', () => {
	it('returns the session row when token matches', async () => {
		const db = makeDb(env.DB);
		await seedUser(db);
		const { token } = await createSession(db, 'u1');
		const row = await findSessionByToken(db, token);
		expect(row?.cid).toBe('u1');
	});
	it('returns null for unknown tokens', async () => {
		const db = makeDb(env.DB);
		await seedUser(db);
		const row = await findSessionByToken(db, 'notatoken');
		expect(row).toBeNull();
	});
});

describe('validateSession', () => {
	const LIFETIME = 30 * 24 * 60 * 60 * 1000;
	const REFRESH = 15 * 24 * 60 * 60 * 1000;
	const HOUR = 60 * 60 * 1000;

	it('returns null and deletes the row when expired', async () => {
		const db = makeDb(env.DB);
		await seedUser(db);
		vi.setSystemTime(new Date(1000));
		const { token } = await createSession(db, 'u1');
		vi.setSystemTime(new Date(1000 + LIFETIME + 1));
		const result = await validateSession(db, token);
		expect(result).toBeNull();
		const rows = await db.select().from(sessions).all();
		expect(rows).toHaveLength(0);
	});

	it('returns null for an unknown token', async () => {
		const db = makeDb(env.DB);
		await seedUser(db);
		vi.setSystemTime(new Date(1000));
		const result = await validateSession(db, 'doesnotexist');
		expect(result).toBeNull();
	});

	it('does not rewrite last_seen_at within the hour', async () => {
		const db = makeDb(env.DB);
		await seedUser(db);
		vi.setSystemTime(new Date(1000));
		const { token } = await createSession(db, 'u1');
		vi.setSystemTime(new Date(1000 + HOUR));
		const result = await validateSession(db, token);
		expect(result?.cid).toBe('u1');
		const stored = await db.select().from(sessions).all();
		expect(stored[0]?.lastSeenAt).toBe(1000);
	});

	it('updates last_seen_at once it is more than an hour old', async () => {
		const db = makeDb(env.DB);
		await seedUser(db);
		vi.setSystemTime(new Date(1000));
		const { token } = await createSession(db, 'u1');
		vi.setSystemTime(new Date(1000 + HOUR + 1));
		const result = await validateSession(db, token);
		expect(result?.lastSeenAt).toBe(1000 + HOUR + 1);
		const stored = await db.select().from(sessions).all();
		expect(stored[0]?.lastSeenAt).toBe(1000 + HOUR + 1);
	});

	it('extends expires_at when within the refresh window', async () => {
		const db = makeDb(env.DB);
		await seedUser(db);
		vi.setSystemTime(new Date(1000));
		const { token, expiresAt } = await createSession(db, 'u1');
		// Move clock so we're inside the refresh window: now > expiresAt - REFRESH
		const nearExpiry = expiresAt - REFRESH + 1;
		vi.setSystemTime(new Date(nearExpiry));
		const result = await validateSession(db, token);
		expect(result).not.toBeNull();
		expect(result!.expiresAt).toBe(nearExpiry + LIFETIME);
	});

	it('does not extend when far from expiry', async () => {
		const db = makeDb(env.DB);
		await seedUser(db);
		vi.setSystemTime(new Date(1000));
		const { token, expiresAt } = await createSession(db, 'u1');
		vi.setSystemTime(new Date(2000));
		const result = await validateSession(db, token);
		expect(result?.expiresAt).toBe(expiresAt);
	});

	it('returns null and deletes the row when the user is disabled', async () => {
		const db = makeDb(env.DB);
		await seedUser(db);
		vi.setSystemTime(new Date(1000));
		const { token } = await createSession(db, 'u1');
		// Bypass setUserActive (which deletes sessions atomically) to create
		// the orphan-session-on-disabled-user state validateSession defends against.
		await db.update(users).set({ active: false }).where(eq(users.cid, 'u1'));
		const result = await validateSession(db, token);
		expect(result).toBeNull();
		const rows = await db.select().from(sessions).all();
		expect(rows).toHaveLength(0);
	});
});
