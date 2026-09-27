// src/users/roles.ts
import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import type { BatchItem } from 'drizzle-orm/batch';
import { z } from 'zod';
import type { DB } from '../db';
import { userRoles } from '../schema';
import { IdentityError } from '../errors';

// `app:permission`, e.g. events:can_sign_up. The prefix keeps apps' names apart.
export const RoleNameSchema = z.string().regex(/^[a-z0-9_-]+:[a-z0-9_.-]+$/);

// remove also accepts `*` (everything the caller granted) or `app:*` (a namespace).
export const RoleRemovePatternSchema = z.union([
	z.literal('*'),
	z.string().regex(/^[a-z0-9_-]+:\*$/),
	RoleNameSchema
]);

export type RolePatch = { add?: string[]; remove?: string[] };

/** A user's effective roles: the distinct union across every source, sorted. */
export async function listRoles(db: DB, cid: string): Promise<string[]> {
	const rows = await db
		.selectDistinct({ role: userRoles.role })
		.from(userRoles)
		.where(eq(userRoles.cid, cid))
		.all();
	return rows.map((r) => r.role).sort();
}

// D1 binds at most 100 parameters per query.
const MAX_BOUND_PARAMS = 100;

/** listRoles for many users at once, keyed by cid (every cid present, possibly []). */
export async function listRolesByCid(db: DB, cids: string[]): Promise<Map<string, string[]>> {
	const byCid = new Map(cids.map((cid) => [cid, [] as string[]]));
	const unique = [...byCid.keys()];
	const chunks = Array.from({ length: Math.ceil(unique.length / MAX_BOUND_PARAMS) }, (_, i) =>
		unique.slice(i * MAX_BOUND_PARAMS, (i + 1) * MAX_BOUND_PARAMS)
	);
	const results = await Promise.all(
		chunks.map((chunk) =>
			db
				.selectDistinct({ cid: userRoles.cid, role: userRoles.role })
				.from(userRoles)
				.where(inArray(userRoles.cid, chunk))
				.all()
		)
	);
	for (const { cid, role } of results.flat()) {
		byCid.get(cid)!.push(role);
	}
	for (const roles of byCid.values()) {
		roles.sort();
	}
	return byCid;
}

export async function listRoleGrants(
	db: DB,
	cid: string
): Promise<{ role: string; source: string }[]> {
	return db
		.select({ role: userRoles.role, source: userRoles.source })
		.from(userRoles)
		.where(eq(userRoles.cid, cid))
		.orderBy(asc(userRoles.role), asc(userRoles.source))
		.all();
}

function removeCondition(pattern: string) {
	if (pattern === '*') {
		return undefined;
	}
	if (pattern.endsWith(':*')) {
		const prefix = pattern.slice(0, -1); // keep the colon: 'community:'
		return sql`substr(${userRoles.role}, 1, ${prefix.length}) = ${prefix}`;
	}
	return eq(userRoles.role, pattern);
}

/**
 * Apply a patch to the roles `source` owns for `cid`: every `remove` pattern
 * first, then every `add`, in one atomic `db.batch`. Rows owned by other sources are
 * never touched. `global:*` roles are granted only by the CLI, never here.
 */
export async function patchRoles(
	db: DB,
	cid: string,
	source: string,
	patch: RolePatch
): Promise<string[]> {
	const add = patch.add ?? [];
	const remove = patch.remove ?? [];
	if (add.some((r) => r.startsWith('global:'))) {
		throw new IdentityError(
			'insufficient_scope',
			403,
			'global:* roles cannot be granted via the API'
		);
	}
	const owned = and(eq(userRoles.cid, cid), eq(userRoles.source, source));
	const statements: BatchItem<'sqlite'>[] = remove.map((pattern) =>
		db.delete(userRoles).where(and(owned, removeCondition(pattern)))
	);
	// One insert per role: D1 caps bound parameters at 100 per query.
	const now = Date.now();
	statements.push(
		...add.map((role) =>
			db.insert(userRoles).values({ cid, role, source, grantedAt: now }).onConflictDoNothing()
		)
	);
	if (statements.length > 0) {
		await db.batch(statements as [BatchItem<'sqlite'>, ...BatchItem<'sqlite'>[]]);
	}
	return listRoles(db, cid);
}
