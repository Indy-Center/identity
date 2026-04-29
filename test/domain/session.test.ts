import { env } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';
import { makeDb } from '../../src/db/client';
import { users, sessions } from '../../src/db/schema';
import { createSessionToken, createSession, findSessionByToken } from '../../src/domain/session';
import { eq } from 'drizzle-orm';

const fixedClock = (t: number) => ({ now: () => t });

async function seedUser(db: ReturnType<typeof makeDb>, id = 'u1', cid = '1') {
	await db.insert(users).values({
		id,
		cid,
		email: 'x@y.com',
		firstName: 'X',
		lastName: 'Y',
		vatsimData: '{}',
		createdAt: 0,
		updatedAt: 0
	});
}

beforeEach(async () => {
	const db = makeDb(env.DB);
	await db.delete(sessions);
	await db.delete(users);
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
		const { token, expiresAt } = await createSession(db, 'u1', fixedClock(1000));
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
		const { token } = await createSession(db, 'u1', fixedClock(1000));
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
