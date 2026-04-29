import { eq } from 'drizzle-orm';
import type { Env } from '../env';
import { makeDb } from '../db/client';
import { userRoles } from '../db/schema';
import {
	validateSession as domainValidate,
	deleteSessionByToken,
	deleteAllSessionsForUser
} from '../domain/session';
import { systemClock } from '../lib/time';

export type SessionPayload = {
	userId: string;
	roles: string[];
};

export async function validate(env: Env, token: string): Promise<SessionPayload | null> {
	const db = makeDb(env.DB);
	const session = await domainValidate(db, token, systemClock);
	if (!session) return null;

	const roleRows = await db
		.select({ role: userRoles.role })
		.from(userRoles)
		.where(eq(userRoles.userId, session.userId))
		.all();

	return {
		userId: session.userId,
		roles: roleRows.map((r) => r.role)
	};
}

export async function invalidate(env: Env, token: string): Promise<void> {
	await deleteSessionByToken(makeDb(env.DB), token);
}

export async function invalidateAllForUser(env: Env, userId: string): Promise<void> {
	await deleteAllSessionsForUser(makeDb(env.DB), userId);
}
