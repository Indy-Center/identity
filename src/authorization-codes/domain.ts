// src/authorization-codes/domain.ts
import { eq, lt } from 'drizzle-orm';
import type { DB } from '../db';
import { authorizationCodes, users } from '../schema';
import { randomBase32, sha256Hex } from '../crypto';
import { createSession } from '../sessions/domain';

export const AUTHORIZATION_CODE_LIFETIME_MS = 60_000;

/** Mint a single-use code for `userId`, bound to `redirectUri`. */
export async function createAuthorizationCode(
	db: DB,
	userId: string,
	redirectUri: string
): Promise<{ code: string; expiresAt: number }> {
	const now = Date.now();
	const code = randomBase32(20);
	const expiresAt = now + AUTHORIZATION_CODE_LIFETIME_MS;
	await db.insert(authorizationCodes).values({
		id: await sha256Hex(code),
		userId,
		redirectUri,
		expiresAt,
		createdAt: now
	});
	return { code, expiresAt };
}

/**
 * Consume a code and create the session it stands for. Returns null for an
 * unknown, used, or expired code, when `redirectUri` differs from the one
 * the code was issued for (RFC 6749 §4.1.3), or when the user is missing or
 * disabled. The code is consumed either way. DELETE … RETURNING makes the
 * consume atomic: only one caller gets the row.
 */
export async function exchangeAuthorizationCode(
	db: DB,
	code: string,
	redirectUri: string
): Promise<{ token: string; expiresAt: number } | null> {
	const now = Date.now();
	// Opportunistic cleanup; there is no cron.
	await db.delete(authorizationCodes).where(lt(authorizationCodes.expiresAt, now));
	const [row] = await db
		.delete(authorizationCodes)
		.where(eq(authorizationCodes.id, await sha256Hex(code)))
		.returning();
	if (!row || row.expiresAt < now || row.redirectUri !== redirectUri) {
		return null;
	}
	const user = await db
		.select({ isActive: users.isActive })
		.from(users)
		.where(eq(users.id, row.userId))
		.get();
	if (!user || !user.isActive) {
		return null;
	}
	return createSession(db, row.userId);
}
