import { env } from 'cloudflare:workers';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { makeDb } from '../../src/db';
import { users, sessions } from '../../src/schema';
import {
	createSessionToken,
	createSession,
	findSessionByToken,
	validateSession
} from '../../src/sessions/domain';

async function seedUser(db: ReturnType<typeof makeDb>, id = 'u1', cid = '1') {
	await db.insert(users).values({
		id,
		cid,
		email: 'x@y.com',
		vatsimData: {
			cid,
			personal: { name_first: 'X', name_last: 'Y', email: 'x@y.com' }
		},
		attributes: {},
		createdAt: 0,
		updatedAt: 0
	});
}

beforeEach(async () => {
	const db = makeDb(env.DB);
	await db.delete(sessions);
	await db.delete(users);
});

afterEach(() => {
	vi.useRealTimers();
});

describe('createSessionToken', () => {
	it('returns distinct base32 tokens', () => {
		const a = createSessionToken();
		const b = createSessionToken();
		expect(a).toMatch(/^[a-z2-7]{32}$/);
		expect(a).not.toBe(b);
	});
});

describe('createSession', () => {
	it('inserts a row keyed by sha256(token), returns raw token', async () => {
		const db = makeDb(env.DB);
		await seedUser(db);
		vi.setSystemTime(new Date(1000));
		const { token, expiresAt } = await createSession(db, 'u1');
		expect(token).toMatch(/^[a-z2-7]{32}$/);
		expect(expiresAt).toBe(1000 + 30 * 24 * 60 * 60 * 1000);
		const rows = await db.select().from(sessions).all();
		expect(rows).toHaveLength(1);
		expect(rows[0]?.userId).toBe('u1');
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
		expect(row?.userId).toBe('u1');
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

	it('returns the session row for a valid token and updates last_seen_at', async () => {
		const db = makeDb(env.DB);
		await seedUser(db);
		vi.setSystemTime(new Date(1000));
		const { token } = await createSession(db, 'u1');
		vi.setSystemTime(new Date(2000));
		const result = await validateSession(db, token);
		expect(result?.userId).toBe('u1');
		const stored = await db.select().from(sessions).all();
		expect(stored[0]?.lastSeenAt).toBe(2000);
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
		await db.update(users).set({ isActive: false }).where(eq(users.id, 'u1'));
		const result = await validateSession(db, token);
		expect(result).toBeNull();
		const rows = await db.select().from(sessions).all();
		expect(rows).toHaveLength(0);
	});
});
