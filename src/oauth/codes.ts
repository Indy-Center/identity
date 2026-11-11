import { eq, lt } from 'drizzle-orm';
import type { DB } from '../db';
import { authorizationCodes, users } from '../schema';
import { randomBase32, sha256Hex } from '../crypto';
import { createSession } from '../sessions/domain';

export const AUTHORIZATION_CODE_LIFETIME_MS = 60_000;

/** Mint a single-use code for `cid`, bound to `redirectUri` and `clientId`. */
export async function createAuthorizationCode(
	db: DB,
	cid: string,
	redirectUri: string,
	clientId: string
): Promise<string> {
	const now = Date.now();
	const code = randomBase32(20);
	await db.insert(authorizationCodes).values({
		id: await sha256Hex(code),
		cid,
		clientId,
		redirectUri,
		expiresAt: now + AUTHORIZATION_CODE_LIFETIME_MS,
		createdAt: now
	});
	return code;
}

/**
 * Consume a code and create the session it stands for. Returns null for an
 * unknown, used, or expired code; when `redirectUri` or `clientId` differs
 * from what the code was issued for (RFC 6749 §4.1.3); or when the user is
 * missing or disabled. The code is consumed either way.
 */
export async function exchangeAuthorizationCode(
	db: DB,
	code: string,
	redirectUri: string,
	clientId: string
): Promise<{ token: string; expiresAt: number; cid: string } | null> {
	const now = Date.now();
	const id = await sha256Hex(code);
	const [[row]] = await db.batch([
		// DELETE … RETURNING makes the consume atomic: only one caller gets the row.
		db.delete(authorizationCodes).where(eq(authorizationCodes.id, id)).returning(),
		// Opportunistic cleanup; there is no cron.
		db.delete(authorizationCodes).where(lt(authorizationCodes.expiresAt, now))
	]);
	if (!row || row.expiresAt < now || row.redirectUri !== redirectUri || row.clientId !== clientId) {
		return null;
	}
	const user = await db
		.select({ active: users.active })
		.from(users)
		.where(eq(users.cid, row.cid))
		.get();
	if (!user || !user.active) {
		return null;
	}
	return { ...(await createSession(db, row.cid, clientId)), cid: row.cid };
}
