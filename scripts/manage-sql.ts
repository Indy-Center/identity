// scripts/manage-sql.ts
// Pure builders for scripts/manage.ts. Kept free of node: imports and
// extension-less paths so both Node (type stripping) and the workers test pool
// can import it.
import { randomBase32, sha256Hex } from '../src/crypto.ts';
import { SCOPES, type Scope } from '../src/schema.ts';

const CLIENT_ID = /^[a-z0-9-]+$/;
// `cli` is the role source for grants made here; a client with that id could
// otherwise remove global:* rows through the API.
const RESERVED_CLIENT_IDS = new Set(['cli']);
const CID = /^\d{1,10}$/;
// Same pattern as RoleNameSchema in src/users/roles.ts (a test keeps them in step).
const ROLE = /^[a-z0-9_-]+:[a-z0-9_.-]+$/;

export function sqlString(value: string): string {
	return `'${value.replaceAll("'", "''")}'`;
}

function assertClientId(id: string): void {
	if (!CLIENT_ID.test(id)) {
		throw new Error(`invalid client id "${id}": use lowercase letters, digits and dashes`);
	}
	if (RESERVED_CLIENT_IDS.has(id)) {
		throw new Error(`invalid client id "${id}": reserved`);
	}
}

function assertTimestamp(now: number): void {
	if (!Number.isSafeInteger(now)) {
		throw new Error(`invalid timestamp ${now}`);
	}
}

/** `<id>_<52 base32 chars>`: 32 random bytes, prefixed for readability. */
export function generateClientSecret(id: string): string {
	assertClientId(id);
	return `${id}_${randomBase32(32)}`;
}

/** What `clients.secret_hash` stores; `authenticateClient` compares against it. */
export function hashSecret(secret: string): Promise<string> {
	return sha256Hex(secret);
}

export async function createClientSql(opts: {
	id: string;
	secret: string;
	scopes: Scope[];
	redirectUris: string[];
	now: number;
}): Promise<string> {
	assertClientId(opts.id);
	assertTimestamp(opts.now);
	for (const s of opts.scopes) {
		if (!(SCOPES as readonly string[]).includes(s)) {
			throw new Error(`unknown scope "${s}" (valid: ${SCOPES.join(', ')})`);
		}
	}
	const redirect =
		opts.redirectUris.length > 0 ? sqlString(JSON.stringify(opts.redirectUris)) : 'NULL';
	return `INSERT INTO clients (id, secret_hash, redirect_uris, scopes, created_at) VALUES (${sqlString(opts.id)}, ${sqlString(await hashSecret(opts.secret))}, ${redirect}, ${sqlString(JSON.stringify(opts.scopes))}, ${opts.now});`;
}

export async function rotateClientSql(id: string, secret: string): Promise<string> {
	assertClientId(id);
	return `UPDATE clients SET secret_hash = ${sqlString(await hashSecret(secret))} WHERE id = ${sqlString(id)}; DELETE FROM client_tokens WHERE client_id = ${sqlString(id)};`;
}

export function deleteClientSql(id: string): string {
	assertClientId(id);
	return `DELETE FROM client_tokens WHERE client_id = ${sqlString(id)}; DELETE FROM clients WHERE id = ${sqlString(id)};`;
}

export const LIST_CLIENTS_SQL =
	'SELECT id, scopes, redirect_uris, created_at FROM clients ORDER BY id;';

function assertGrant(cid: string, role: string): void {
	if (!CID.test(cid)) {
		throw new Error(`invalid cid "${cid}"`);
	}
	if (!ROLE.test(role)) {
		throw new Error(`invalid role "${role}": use app:permission`);
	}
}

export function grantRoleSql(cid: string, role: string, now: number): string {
	assertGrant(cid, role);
	assertTimestamp(now);
	return `INSERT INTO user_roles (cid, role, source, granted_at) VALUES (${sqlString(cid)}, ${sqlString(role)}, 'cli', ${now}) ON CONFLICT DO NOTHING;`;
}

export function revokeRoleSql(cid: string, role: string): string {
	assertGrant(cid, role);
	return `DELETE FROM user_roles WHERE cid = ${sqlString(cid)} AND role = ${sqlString(role)} AND source = 'cli';`;
}
