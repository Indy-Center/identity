import { eq } from 'drizzle-orm';
import type { DB } from '../db';
import { sessions, users, type Session } from '../schema';
import { randomBase32, sha256Hex } from '../crypto';

export const SESSION_LIFETIME_MS = 30 * 24 * 60 * 60 * 1000;
export const SESSION_REFRESH_THRESHOLD_MS = 15 * 24 * 60 * 60 * 1000;

export function createSessionToken(): string {
	return randomBase32(20);
}

export async function hashSessionToken(token: string): Promise<string> {
	return sha256Hex(token);
}

export async function createSession(
	db: DB,
	userId: string
): Promise<{ token: string; expiresAt: number }> {
	const now = Date.now();
	const token = createSessionToken();
	const id = await hashSessionToken(token);
	const expiresAt = now + SESSION_LIFETIME_MS;
	await db.insert(sessions).values({
		id,
		userId,
		expiresAt,
		createdAt: now,
		lastSeenAt: now
	});
	return { token, expiresAt };
}

export async function findSessionByToken(db: DB, token: string): Promise<Session | null> {
	const id = await hashSessionToken(token);
	const row = await db.select().from(sessions).where(eq(sessions.id, id)).get();
	return row ?? null;
}

export async function deleteSessionByToken(db: DB, token: string): Promise<void> {
	const id = await hashSessionToken(token);
	await db.delete(sessions).where(eq(sessions.id, id));
}

export async function deleteAllSessionsForUser(db: DB, userId: string): Promise<void> {
	await db.delete(sessions).where(eq(sessions.userId, userId));
}

export async function validateSession(db: DB, token: string): Promise<Session | null> {
	const now = Date.now();
	const id = await hashSessionToken(token);
	const row = await db
		.select({ session: sessions, isActive: users.isActive })
		.from(sessions)
		.innerJoin(users, eq(users.id, sessions.userId))
		.where(eq(sessions.id, id))
		.get();
	if (!row) {
		return null;
	}
	// Defense-in-depth: setUserActive(false) atomically deletes sessions, but
	// the JOIN + isActive check protects against any path that leaves an
	// orphan session row attached to a disabled user.
	if (row.session.expiresAt < now || !row.isActive) {
		await db.delete(sessions).where(eq(sessions.id, row.session.id));
		return null;
	}
	const shouldRefresh = row.session.expiresAt - now < SESSION_REFRESH_THRESHOLD_MS;
	const newExpiresAt = shouldRefresh ? now + SESSION_LIFETIME_MS : row.session.expiresAt;
	await db
		.update(sessions)
		.set({ lastSeenAt: now, expiresAt: newExpiresAt })
		.where(eq(sessions.id, row.session.id));
	return { ...row.session, lastSeenAt: now, expiresAt: newExpiresAt };
}
