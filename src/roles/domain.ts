import { and, eq } from 'drizzle-orm';
import type { DB } from '../db';
import { userRoles } from '../schema';

export async function add(
	db: DB,
	userId: string,
	role: string,
	opts: { grantedBy?: string } = {}
): Promise<void> {
	await db
		.insert(userRoles)
		.values({ userId, role, grantedAt: Date.now(), grantedBy: opts.grantedBy ?? null })
		.onConflictDoNothing();
}

export async function remove(db: DB, userId: string, role: string): Promise<void> {
	await db.delete(userRoles).where(and(eq(userRoles.userId, userId), eq(userRoles.role, role)));
}

export async function set(
	db: DB,
	userId: string,
	roles: string[],
	opts: { grantedBy?: string } = {}
): Promise<void> {
	const deleteStmt = db.delete(userRoles).where(eq(userRoles.userId, userId));
	if (roles.length === 0) {
		await deleteStmt;
		return;
	}
	const now = Date.now();
	const insertStmt = db.insert(userRoles).values(
		roles.map((role) => ({
			userId,
			role,
			grantedAt: now,
			grantedBy: opts.grantedBy ?? null
		}))
	);
	// db.batch wraps statements in a single D1 transaction — if either
	// fails the other rolls back, so we never end up with the user's
	// roles partially-replaced.
	await db.batch([deleteStmt, insertStmt]);
}

export async function get(db: DB, userId: string): Promise<string[]> {
	const rows = await db
		.select({ role: userRoles.role })
		.from(userRoles)
		.where(eq(userRoles.userId, userId))
		.all();
	return rows.map((r) => r.role);
}
