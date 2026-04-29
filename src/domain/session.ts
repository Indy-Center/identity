import { eq } from 'drizzle-orm';
import type { DB } from '../db/client';
import { sessions, type Session } from '../db/schema';
import { randomBase32, sha256Hex } from '../lib/crypto';
import type { Clock } from '../lib/time';

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
	userId: string,
	clock: Clock
): Promise<{ token: string; expiresAt: number }> {
	const token = createSessionToken();
	const id = await hashSessionToken(token);
	const now = clock.now();
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
