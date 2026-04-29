import { eq } from 'drizzle-orm';
import type { DB } from '../db/client';
import { users } from '../db/schema';
import type { Clock } from '../lib/time';

export type VatsimProfile = {
	cid: string;
	personal: { name_first: string; name_last: string; email: string };
	[key: string]: unknown;
};

export async function upsertFromVatsim(
	db: DB,
	profile: VatsimProfile,
	clock: Clock
): Promise<string> {
	const now = clock.now();
	const existing = await db.select().from(users).where(eq(users.cid, profile.cid)).get();
	if (existing) {
		await db
			.update(users)
			.set({
				email: profile.personal.email,
				firstName: profile.personal.name_first,
				lastName: profile.personal.name_last,
				vatsimData: JSON.stringify(profile),
				updatedAt: now
			})
			.where(eq(users.id, existing.id));
		return existing.id;
	}
	const id = crypto.randomUUID();
	await db.insert(users).values({
		id,
		cid: profile.cid,
		email: profile.personal.email,
		firstName: profile.personal.name_first,
		lastName: profile.personal.name_last,
		vatsimData: JSON.stringify(profile),
		createdAt: now,
		updatedAt: now
	});
	return id;
}
