import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import type { BatchItem } from 'drizzle-orm/batch';
import { z } from 'zod';
import type { DB } from '../db';
import { userRoles } from '../schema';
import { IdentityError } from '../errors';
import { ROLE_NAME } from './role-name';

// `app:permission`, e.g. events:can_sign_up (pattern in role-name.ts).
export const RoleNameSchema = z.string().regex(ROLE_NAME);

// remove also accepts `*` (everything the caller granted) or `app:*` (a namespace).
export const RoleRemovePatternSchema = z.union([
	z.literal('*'),
	z.string().regex(/^[a-z0-9_-]+:\*$/),
	RoleNameSchema
]);

export type RolePatch = { add?: string[]; remove?: string[] };

// The OpenAPI doc schema for listRoleGrants()'s shape — not used to validate
// anything. listRoleGrants()'s return type is annotated against RoleGrant
// (below), so the two can never drift without a typecheck failure.
export const RoleGrantSchema = z.object({ role: z.string(), source: z.string() });
export type RoleGrant = z.infer<typeof RoleGrantSchema>;

/** A user's effective roles: the distinct union across every source, sorted. */
export async function listRoles(db: DB, cid: string): Promise<string[]> {
	const rows = await db
		.selectDistinct({ role: userRoles.role })
		.from(userRoles)
		.where(eq(userRoles.cid, cid))
		.all();
	return rows.map((r) => r.role).sort();
}

/**
 * Every role of every user who holds `role`, keyed by cid. One query with a
 * subquery, so it binds one parameter however many holders there are.
 */
export async function listRolesOfHolders(db: DB, role: string): Promise<Map<string, string[]>> {
	const holders = db.select({ cid: userRoles.cid }).from(userRoles).where(eq(userRoles.role, role));
	const rows = await db
		.selectDistinct({ cid: userRoles.cid, role: userRoles.role })
		.from(userRoles)
		.where(inArray(userRoles.cid, holders))
		.orderBy(asc(userRoles.role))
		.all();
	const byCid = new Map<string, string[]>();
	for (const r of rows) {
		const roles = byCid.get(r.cid) ?? [];
		roles.push(r.role);
		byCid.set(r.cid, roles);
	}
	return byCid;
}

export async function listRoleGrants(db: DB, cid: string): Promise<RoleGrant[]> {
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
 * never touched. `global:*` roles are added and removed only by the CLI (which
 * writes SQL directly), never here: naming them in `add` or `remove` is refused
 * for every source. A bare `*` stays allowed, because it only reaches the
 * caller's own rows.
 */
export async function patchRoles(
	db: DB,
	cid: string,
	source: string,
	patch: RolePatch
): Promise<string[]> {
	const add = patch.add ?? [];
	const remove = patch.remove ?? [];
	if ([...add, ...remove].some((r) => r.startsWith('global:'))) {
		throw new IdentityError(
			'access_denied',
			403,
			'global:* roles cannot be added or removed via the API'
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
