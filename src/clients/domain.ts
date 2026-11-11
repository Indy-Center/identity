// Registered clients and their client-credentials tokens (RFC 6749 §4.4).
import { and, asc, eq, gt, lt } from 'drizzle-orm';
import type { DB } from '../db';
import { clients, clientTokens, SCOPES, type Client, type Scope } from '../schema';
import { randomBase32, sha256Hex } from '../crypto';
import { IdentityError } from '../errors';
import { newClientSecret } from './registration';

export const CLIENT_TOKEN_LIFETIME_MS = 60 * 60 * 1000;

export async function findClient(db: DB, id: string): Promise<Client | null> {
	return (await db.select().from(clients).where(eq(clients.id, id)).get()) ?? null;
}

export function listClients(db: DB) {
	return db
		.select({
			id: clients.id,
			scopes: clients.scopes,
			redirectUris: clients.redirectUris,
			createdAt: clients.createdAt
		})
		.from(clients)
		.orderBy(asc(clients.id))
		.all();
}

/** Register a client and return its secret, which is stored only as a hash. */
export async function createClient(
	db: DB,
	registration: { id: string; scopes: Scope[]; redirectUris: string[] }
): Promise<string> {
	const { id, scopes, redirectUris } = registration;
	const secret = newClientSecret(id);
	const [row] = await db
		.insert(clients)
		.values({
			id,
			secretHash: await sha256Hex(secret),
			redirectUris: redirectUris.length > 0 ? redirectUris : null,
			scopes,
			createdAt: Date.now()
		})
		.onConflictDoNothing()
		.returning({ id: clients.id });
	if (!row) {
		throw new IdentityError('conflict', 409, `client ${id} already exists`);
	}
	return secret;
}

/** Give the client a new secret and return it; its outstanding tokens are dropped. */
export async function rotateClientSecret(db: DB, id: string): Promise<string> {
	const secret = newClientSecret(id);
	const [rows] = await db.batch([
		db
			.update(clients)
			.set({ secretHash: await sha256Hex(secret) })
			.where(eq(clients.id, id))
			.returning({ id: clients.id }),
		db.delete(clientTokens).where(eq(clientTokens.clientId, id))
	]);
	if (!rows[0]) {
		throw new IdentityError('not_found', 404, `client ${id} not found`);
	}
	return secret;
}

/**
 * Replace a client's scopes and/or redirect URIs, keeping its secret. Its
 * tokens carry the scopes they were issued with, so a scope change drops them.
 */
export async function updateClient(
	db: DB,
	id: string,
	patch: { scopes?: Scope[]; redirectUris?: string[] }
) {
	const update = db
		.update(clients)
		.set({
			scopes: patch.scopes,
			redirectUris: patch.redirectUris?.length === 0 ? null : patch.redirectUris
		})
		.where(eq(clients.id, id))
		.returning();
	const [rows] = patch.scopes
		? await db.batch([update, db.delete(clientTokens).where(eq(clientTokens.clientId, id))])
		: [await update];
	const row = rows[0];
	if (!row) {
		throw new IdentityError('not_found', 404, `client ${id} not found`);
	}
	return row;
}

export async function deleteClient(db: DB, id: string): Promise<void> {
	const [, rows] = await db.batch([
		db.delete(clientTokens).where(eq(clientTokens.clientId, id)),
		db.delete(clients).where(eq(clients.id, id)).returning({ id: clients.id })
	]);
	if (!rows[0]) {
		throw new IdentityError('not_found', 404, `client ${id} not found`);
	}
}

/** The client if `secret` is its secret, else null. Compares sha256 digests in SQL. */
export async function authenticateClient(
	db: DB,
	id: string,
	secret: string
): Promise<Client | null> {
	const row = await db
		.select()
		.from(clients)
		.where(and(eq(clients.id, id), eq(clients.secretHash, await sha256Hex(secret))))
		.get();
	return row ?? null;
}

/** `users:write` implies `users:read`. */
export function hasScope(scopes: readonly Scope[], needed: Scope): boolean {
	return scopes.includes(needed) || (needed === 'users:read' && scopes.includes('users:write'));
}

/**
 * RFC 6749 §3.3: the requested scopes (space-delimited) if the client may have
 * all of them, every allowed scope if none were requested, else null.
 */
export function grantScopes(
	allowed: readonly Scope[],
	requested: string | undefined
): Scope[] | null {
	if (requested === undefined || requested.trim() === '') {
		return [...allowed];
	}
	const wanted = new Set(requested.trim().split(/\s+/));
	const granted = SCOPES.filter((s) => wanted.has(s) && hasScope(allowed, s));
	return granted.length === wanted.size ? granted : null;
}

export async function issueClientToken(
	db: DB,
	clientId: string,
	scopes: Scope[]
): Promise<{ token: string; expiresIn: number; scopes: Scope[] }> {
	const now = Date.now();
	const token = randomBase32(20);
	const id = await sha256Hex(token);
	await db.batch([
		// Opportunistic cleanup of expired tokens (there is no cron), done here so
		// validation, which runs on every /api request, stays a pure read.
		db.delete(clientTokens).where(lt(clientTokens.expiresAt, now)),
		db
			.insert(clientTokens)
			.values({ id, clientId, scopes, expiresAt: now + CLIENT_TOKEN_LIFETIME_MS, createdAt: now })
	]);
	return { token, expiresIn: CLIENT_TOKEN_LIFETIME_MS / 1000, scopes };
}

export async function validateClientToken(
	db: DB,
	token: string
): Promise<{ clientId: string; scopes: Scope[] } | null> {
	const row = await db
		.select({ clientId: clientTokens.clientId, scopes: clientTokens.scopes })
		.from(clientTokens)
		.where(and(eq(clientTokens.id, await sha256Hex(token)), gt(clientTokens.expiresAt, Date.now())))
		.get();
	return row ?? null;
}

export async function revokeClientToken(db: DB, token: string): Promise<void> {
	await db.delete(clientTokens).where(eq(clientTokens.id, await sha256Hex(token)));
}
