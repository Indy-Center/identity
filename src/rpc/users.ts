import { eq } from 'drizzle-orm';
import type { Env } from '../env';
import { makeDb } from '../db/client';
import { users, userRoles, type User } from '../db/schema';

export async function getById(env: Env, id: string): Promise<User | null> {
	const db = makeDb(env.DB);
	const row = await db.select().from(users).where(eq(users.id, id)).get();
	return row ?? null;
}

export async function getByCid(env: Env, cid: string): Promise<User | null> {
	const db = makeDb(env.DB);
	const row = await db.select().from(users).where(eq(users.cid, cid)).get();
	return row ?? null;
}

export async function listByRole(env: Env, role: string): Promise<User[]> {
	const db = makeDb(env.DB);
	return db
		.select({
			id: users.id,
			cid: users.cid,
			email: users.email,
			firstName: users.firstName,
			lastName: users.lastName,
			preferredName: users.preferredName,
			pronouns: users.pronouns,
			discordId: users.discordId,
			vatsimData: users.vatsimData,
			createdAt: users.createdAt,
			updatedAt: users.updatedAt
		})
		.from(users)
		.innerJoin(userRoles, eq(userRoles.userId, users.id))
		.where(eq(userRoles.role, role))
		.all();
}
