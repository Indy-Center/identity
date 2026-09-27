// src/clients/domain.ts
// Registered clients and their client-credentials tokens (RFC 6749 §4.4).
import { and, eq, gt, lt } from 'drizzle-orm';
import type { DB } from '../db';
import { clients, clientTokens, type Client, type Scope } from '../schema';
import { randomBase32, sha256Hex } from '../crypto';

export const SCOPES: readonly Scope[] = ['users:read', 'users:write'];
export const CLIENT_TOKEN_LIFETIME_MS = 60 * 60 * 1000;

export async function findClient(db: DB, id: string): Promise<Client | null> {
	return (await db.select().from(clients).where(eq(clients.id, id)).get()) ?? null;
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
	const wanted = [...new Set(requested.trim().split(/\s+/))];
	const ok = wanted.every(
		(s) => (SCOPES as readonly string[]).includes(s) && hasScope(allowed, s as Scope)
	);
	return ok ? (wanted as Scope[]) : null;
}

export async function issueClientToken(
	db: DB,
	clientId: string,
	scopes: Scope[]
): Promise<{ token: string; expiresIn: number; scopes: Scope[] }> {
	const now = Date.now();
	const token = randomBase32(20);
	await db.insert(clientTokens).values({
		id: await sha256Hex(token),
		clientId,
		scopes,
		expiresAt: now + CLIENT_TOKEN_LIFETIME_MS,
		createdAt: now
	});
	return { token, expiresIn: CLIENT_TOKEN_LIFETIME_MS / 1000, scopes };
}

export async function validateClientToken(
	db: DB,
	token: string
): Promise<{ clientId: string; scopes: Scope[] } | null> {
	const now = Date.now();
	// Opportunistic cleanup; there is no cron.
	await db.delete(clientTokens).where(lt(clientTokens.expiresAt, now));
	const row = await db
		.select({ clientId: clientTokens.clientId, scopes: clientTokens.scopes })
		.from(clientTokens)
		.where(and(eq(clientTokens.id, await sha256Hex(token)), gt(clientTokens.expiresAt, now)))
		.get();
	return row ?? null;
}

export async function revokeClientToken(db: DB, token: string): Promise<void> {
	await db.delete(clientTokens).where(eq(clientTokens.id, await sha256Hex(token)));
}
