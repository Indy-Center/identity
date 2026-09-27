// src/users/roles.ts
import { and, asc, eq, sql } from 'drizzle-orm';
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
	if (add.length > 0) {
		const now = Date.now();
		statements.push(
			db
				.insert(userRoles)
				.values(add.map((role) => ({ cid, role, source, grantedAt: now })))
				.onConflictDoNothing()
		);
	}
	if (statements.length > 0) {
		await db.batch(statements as [BatchItem<'sqlite'>, ...BatchItem<'sqlite'>[]]);
	}
	return listRoles(db, cid);
}
