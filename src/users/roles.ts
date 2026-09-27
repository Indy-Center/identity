// src/users/roles.ts
import { eq } from 'drizzle-orm';
import type { DB } from '../db';
import { userRoles } from '../schema';

/** A user's effective roles: the distinct union across every source, sorted. */
export async function listRoles(db: DB, cid: string): Promise<string[]> {
	const rows = await db
		.selectDistinct({ role: userRoles.role })
		.from(userRoles)
		.where(eq(userRoles.cid, cid))
		.all();
	return rows.map((r) => r.role).sort();
}
