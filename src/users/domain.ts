// src/users/domain.ts
import { and, eq } from 'drizzle-orm';
import { sessions, userRoles, users, type User } from '../schema';
import type { DB } from '../db';
import type { VatsimProfile } from '../oauth/vatsim';
import { IdentityError } from '../errors';

// Writes only the VATSIM-owned columns; identity-owned columns keep their values.
export async function upsertFromVatsim(db: DB, profile: VatsimProfile): Promise<User> {
	const now = Date.now();
	const vatsim = {
		firstName: profile.personal.name_first ?? null,
		lastName: profile.personal.name_last ?? null,
		email: profile.personal.email,
		rating: profile.vatsim?.rating?.short ?? null,
		pilotRating: profile.vatsim?.pilotrating?.short ?? null,
		division: profile.vatsim?.division?.id ?? null,
		region: profile.vatsim?.region?.id ?? null,
		subdivision: profile.vatsim?.subdivision?.id ?? null,
		vatsimProfile: profile,
		vatsimSyncedAt: now
	};
	const [row] = await db
		.insert(users)
		.values({ cid: profile.cid, ...vatsim, createdAt: now, updatedAt: now })
		.onConflictDoUpdate({ target: users.cid, set: { ...vatsim, updatedAt: now } })
		.returning();
	return row!;
}

export async function getUser(db: DB, cid: string): Promise<User | null> {
	return (await db.select().from(users).where(eq(users.cid, cid)).get()) ?? null;
}

export type UserFilter = { role: string } | { discordId: string };

export async function listUsers(db: DB, filter: UserFilter): Promise<User[]> {
	if ('discordId' in filter) {
		return db.select().from(users).where(eq(users.discordId, filter.discordId)).all();
	}
	const rows = await db
		.selectDistinct({ user: users })
		.from(users)
		.innerJoin(userRoles, eq(userRoles.cid, users.cid))
		.where(eq(userRoles.role, filter.role))
		.all();
	return rows.map((r) => r.user);
}

// Identity-owned profile fields. `null` clears a field; `undefined` leaves it.
export type ProfilePatch = {
	preferredName?: string | null;
	pronouns?: string | null;
	operatingInitials?: string | null;
	discordId?: string | null;
};

function isUniqueViolation(err: unknown): boolean {
	for (let e: unknown = err; e; e = (e as { cause?: unknown }).cause) {
		if (e instanceof Error && e.message.includes('UNIQUE constraint failed')) {
			return true;
		}
	}
	return false;
}

export async function updateProfile(db: DB, cid: string, patch: ProfilePatch): Promise<User> {
	const set = Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined));
	if (Object.keys(set).length === 0) {
		const user = await getUser(db, cid);
		if (!user) {
			throw new IdentityError('not_found', 404, `user ${cid} not found`);
		}
		return user;
	}
	try {
		const [row] = await db
			.update(users)
			.set({ ...set, updatedAt: Date.now() })
			.where(eq(users.cid, cid))
			.returning();
		if (!row) {
			throw new IdentityError('not_found', 404, `user ${cid} not found`);
		}
		return row;
	} catch (err) {
		if (isUniqueViolation(err)) {
			throw new IdentityError('conflict', 409, 'discord_id or operating_initials already in use');
		}
		throw err;
	}
}

export async function setUserActive(
	db: DB,
	cid: string,
	active: boolean,
	opts: { reason?: string } = {}
): Promise<User> {
	const now = Date.now();
	const update = db
		.update(users)
		.set(
			active
				? { active, disabledReason: null, disabledAt: null, updatedAt: now }
				: { active, disabledReason: opts.reason ?? null, disabledAt: now, updatedAt: now }
		)
		.where(eq(users.cid, cid))
		.returning();
	// Disabling revokes every session in the same transaction.
	const [rows] = active
		? [await update]
		: await db.batch([update, db.delete(sessions).where(eq(sessions.cid, cid))]);
	const row = rows[0];
	if (!row) {
		throw new IdentityError('not_found', 404, `user ${cid} not found`);
	}
	return row;
}
