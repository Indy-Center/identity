import { and, eq } from 'drizzle-orm';
import type { Env } from '../env';
import { makeDb } from '../db/client';
import { userRoles } from '../db/schema';

export async function add(
	env: Env,
	userId: string,
	role: string,
	opts: { grantedBy?: string } = {}
): Promise<void> {
	const db = makeDb(env.DB);
	await db
		.insert(userRoles)
		.values({ userId, role, grantedAt: Date.now(), grantedBy: opts.grantedBy ?? null })
		.onConflictDoNothing();
}

export async function remove(env: Env, userId: string, role: string): Promise<void> {
	const db = makeDb(env.DB);
	await db.delete(userRoles).where(and(eq(userRoles.userId, userId), eq(userRoles.role, role)));
}

export async function set(
	env: Env,
	userId: string,
	roles: string[],
	opts: { grantedBy?: string } = {}
): Promise<void> {
	const db = makeDb(env.DB);
	const now = Date.now();
	await db.delete(userRoles).where(eq(userRoles.userId, userId));
	if (roles.length > 0) {
		await db.insert(userRoles).values(
			roles.map((role) => ({
				userId,
				role,
				grantedAt: now,
				grantedBy: opts.grantedBy ?? null
			}))
		);
	}
}

export async function get(env: Env, userId: string): Promise<string[]> {
	const db = makeDb(env.DB);
	const rows = await db
		.select({ role: userRoles.role })
		.from(userRoles)
		.where(eq(userRoles.userId, userId))
		.all();
	return rows.map((r) => r.role);
}
