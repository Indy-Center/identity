import { eq, sql } from 'drizzle-orm';
import { sessions, users, userRoles } from '../schema';
import type { DB } from '../db';
import { AttributePatchSchema, type AttributePatch } from '../client/attributes';
import { IdentityError } from '../client/errors';
import type { User } from '../client/user';
import type { VatsimProfile } from '../client/vatsim';

export async function upsertFromVatsim(db: DB, profile: VatsimProfile): Promise<User> {
	const now = Date.now();
	const id = crypto.randomUUID();

	const [row] = await db
		.insert(users)
		.values({
			id,
			cid: profile.cid,
			email: profile.personal.email,
			vatsimData: profile,
			attributes: {},
			isActive: true,
			createdAt: now,
			updatedAt: now
		})
		.onConflictDoUpdate({
			target: users.cid,
			set: {
				email: profile.personal.email,
				vatsimData: profile,
				updatedAt: now
			}
		})
		.returning();

	return row!;
}

export async function setUserActive(
	db: DB,
	userId: string,
	active: boolean,
	opts: { reason?: string; changedBy?: string } = {}
): Promise<User> {
	const now = Date.now();

	// Build the attributes patch:
	//   - enabling clears disabled* keys (null = delete)
	//   - disabling writes them
	const patchObj: Record<string, unknown> = {};
	if (active) {
		patchObj.disabledReason = null;
		patchObj.disabledAt = null;
		patchObj.disabledBy = null;
	} else {
		patchObj.disabledAt = now;
		if (opts.reason !== undefined) patchObj.disabledReason = opts.reason;
		if (opts.changedBy !== undefined) patchObj.disabledBy = opts.changedBy;
	}
	const patchJson = JSON.stringify(patchObj);

	const updateStmt = db
		.update(users)
		.set({
			isActive: active,
			attributes: sql`json_patch(${users.attributes}, ${patchJson})`,
			updatedAt: now
		})
		.where(eq(users.id, userId))
		.returning();

	let row: User | undefined;
	if (active) {
		[row] = await updateStmt;
	} else {
		// Disabling must invalidate every existing session in the same
		// transaction — validateSession does not re-check isActive, so a
		// partial commit would leave a banned user with live cookies.
		const deleteSessionsStmt = db.delete(sessions).where(eq(sessions.userId, userId));
		const [updated] = await db.batch([updateStmt, deleteSessionsStmt]);
		[row] = updated;
	}

	if (!row) {
		throw new IdentityError('not_found', 404, `user ${userId} not found`);
	}

	return row;
}

export async function setAttributes(db: DB, userId: string, patch: AttributePatch): Promise<User> {
	const validated = AttributePatchSchema.parse(patch);

	// Strip undefined keys — they should not appear in the patch JSON.
	// JSON.stringify drops them automatically, but being explicit keeps
	// intent obvious for the next reader.
	const patchObj: Record<string, unknown> = {};
	for (const [key, value] of Object.entries(validated)) {
		if (value !== undefined) patchObj[key] = value;
	}
	const patchJson = JSON.stringify(patchObj);

	const [row] = await db
		.update(users)
		.set({
			attributes: sql`json_patch(${users.attributes}, ${patchJson})`,
			updatedAt: Date.now()
		})
		.where(eq(users.id, userId))
		.returning();

	if (!row) {
		throw new IdentityError('not_found', 404, `user ${userId} not found`);
	}
	return row;
}

export async function getById(db: DB, id: string): Promise<User | null> {
	const row = await db.select().from(users).where(eq(users.id, id)).get();
	return row ?? null;
}

export async function getByCid(db: DB, cid: string): Promise<User | null> {
	const row = await db.select().from(users).where(eq(users.cid, cid)).get();
	return row ?? null;
}

export async function getByEmail(db: DB, email: string): Promise<User[]> {
	return db.select().from(users).where(eq(users.email, email)).all();
}

export async function listAll(db: DB): Promise<User[]> {
	return db.select().from(users).all();
}

export async function listByRole(db: DB, role: string): Promise<User[]> {
	const rows = await db
		.select()
		.from(users)
		.innerJoin(userRoles, eq(userRoles.userId, users.id))
		.where(eq(userRoles.role, role))
		.all();
	return rows.map((r) => r.users);
}

export async function listOperatingInitials(db: DB): Promise<string[]> {
	// Query the JSON 'attributes' column for operatingInitials values.
	// SQLite json_extract is supported by D1.
	const rows = await db
		.select({
			oi: sql<string>`json_extract(${users.attributes}, '$.operatingInitials')`
		})
		.from(users)
		.all();
	const set = new Set<string>();
	for (const r of rows) {
		if (typeof r.oi === 'string' && r.oi.length > 0) set.add(r.oi);
	}
	return [...set];
}
