import { eq } from 'drizzle-orm';
import type { Env } from '../env';
import { makeDb } from '../db/client';
import { users, type User } from '../db/schema';

export type ProfilePatch = {
	preferredName?: string | null;
	pronouns?: string | null;
	discordId?: string | null;
};

const ALLOWED: (keyof ProfilePatch)[] = ['preferredName', 'pronouns', 'discordId'];

export async function update(env: Env, userId: string, patch: ProfilePatch): Promise<User> {
	const db = makeDb(env.DB);
	const filtered: Partial<typeof users.$inferInsert> = { updatedAt: Date.now() };
	for (const key of ALLOWED) {
		if (key in patch) filtered[key] = patch[key];
	}
	await db.update(users).set(filtered).where(eq(users.id, userId));
	const row = await db.select().from(users).where(eq(users.id, userId)).get();
	if (!row) throw new Error('user vanished after update');
	return row;
}
