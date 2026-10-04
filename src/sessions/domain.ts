import { eq, lt } from 'drizzle-orm';
import type { DB } from '../db';
import { sessions, users, type Session } from '../schema';
import { randomBase32, sha256Hex } from '../crypto';

const SESSION_LIFETIME_MS = 30 * 24 * 60 * 60 * 1000;
const SESSION_REFRESH_THRESHOLD_MS = 15 * 24 * 60 * 60 * 1000;
const LAST_SEEN_WRITE_INTERVAL_MS = 60 * 60 * 1000;

export async function createSession(
	db: DB,
	cid: string,
	clientId: string | null = null
): Promise<{ token: string; expiresAt: number }> {
	const now = Date.now();
	// Opportunistic cleanup of abandoned sessions; there is no cron.
	await db.delete(sessions).where(lt(sessions.expiresAt, now));
	const token = randomBase32(20);
	const id = await sha256Hex(token);
	const expiresAt = now + SESSION_LIFETIME_MS;
	await db.insert(sessions).values({
		id,
		cid,
		clientId,
		expiresAt,
		createdAt: now,
		lastSeenAt: now
	});
	return { token, expiresAt };
}

export async function findSessionByToken(db: DB, token: string): Promise<Session | null> {
	const id = await sha256Hex(token);
	const row = await db.select().from(sessions).where(eq(sessions.id, id)).get();
	return row ?? null;
}

export async function deleteSessionByToken(db: DB, token: string): Promise<void> {
	const id = await sha256Hex(token);
	await db.delete(sessions).where(eq(sessions.id, id));
}

export async function deleteAllSessionsForUser(db: DB, cid: string): Promise<void> {
	await db.delete(sessions).where(eq(sessions.cid, cid));
}

export async function validateSession(db: DB, token: string): Promise<Session | null> {
	const now = Date.now();
	const id = await sha256Hex(token);
	const row = await db
		.select({ session: sessions, active: users.active })
		.from(sessions)
		.innerJoin(users, eq(users.cid, sessions.cid))
		.where(eq(sessions.id, id))
		.get();
	if (!row) {
		return null;
	}
	// Defense-in-depth: setUserActive(false) atomically deletes sessions, but
	// the JOIN + active check protects against any path that leaves an
	// orphan session row attached to a disabled user.
	if (row.session.expiresAt < now || !row.active) {
		await db.delete(sessions).where(eq(sessions.id, row.session.id));
		return null;
	}
	const shouldRefresh = row.session.expiresAt - now < SESSION_REFRESH_THRESHOLD_MS;
	// Every /api and /oauth/userinfo call validates a session, so only write
	// when extending it or when lastSeenAt has gone stale.
	if (!shouldRefresh && now - row.session.lastSeenAt <= LAST_SEEN_WRITE_INTERVAL_MS) {
		return row.session;
	}
	const newExpiresAt = shouldRefresh ? now + SESSION_LIFETIME_MS : row.session.expiresAt;
	await db
		.update(sessions)
		.set({ lastSeenAt: now, expiresAt: newExpiresAt })
		.where(eq(sessions.id, row.session.id));
	return { ...row.session, lastSeenAt: now, expiresAt: newExpiresAt };
}
