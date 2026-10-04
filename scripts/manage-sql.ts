// Pure builders for scripts/manage.ts. Kept free of node: imports and
// extension-less paths so both Node (type stripping) and the workers test pool
// can import it.
import { sha256Hex } from '../src/crypto.ts';
import {
	clientIdProblem,
	newClientSecret,
	redirectUriProblem
} from '../src/clients/registration.ts';
import { SCOPES, type Scope } from '../src/schema.ts';
import { ROLE_NAME } from '../src/users/role-name.ts';

// VATSIM CIDs: positive integers, no leading zeros (so '01' can't shadow '1').
const CID = /^[1-9]\d{0,9}$/;

export function sqlString(value: string): string {
	return `'${value.replaceAll("'", "''")}'`;
}

function assertClientId(id: string): void {
	const problem = clientIdProblem(id);
	if (problem) {
		throw new Error(`invalid client id "${id}": ${problem}`);
	}
}

function assertTimestamp(now: number): void {
	if (!Number.isSafeInteger(now)) {
		throw new Error(`invalid timestamp ${now}`);
	}
}

function assertRedirectUri(uri: string): void {
	const problem = redirectUriProblem(uri);
	if (problem) {
		throw new Error(`invalid redirect uri "${uri}": ${problem}`);
	}
}

function assertScopes(scopes: string[]): void {
	for (const s of scopes) {
		if (!(SCOPES as readonly string[]).includes(s)) {
			throw new Error(`unknown scope "${s}" (valid: ${SCOPES.join(', ')})`);
		}
	}
}

export function generateClientSecret(id: string): string {
	assertClientId(id);
	return newClientSecret(id);
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
	assertScopes(opts.scopes);
	opts.redirectUris.forEach(assertRedirectUri);
	if (opts.scopes.length === 0 && opts.redirectUris.length === 0) {
		throw new Error(
			'a client needs at least one --scope or --redirect-uri, else it can do nothing'
		);
	}
	const redirect =
		opts.redirectUris.length > 0 ? sqlString(JSON.stringify(opts.redirectUris)) : 'NULL';
	return `INSERT INTO clients (id, secret_hash, redirect_uris, scopes, created_at) VALUES (${sqlString(opts.id)}, ${sqlString(await sha256Hex(opts.secret))}, ${redirect}, ${sqlString(JSON.stringify(opts.scopes))}, ${opts.now});`;
}

// rotate, delete and revoke end their main statement in RETURNING so the CLI
// can count the rows it hit (local D1 reports no `changes` in --json output)
// and fail loudly when the client or grant does not exist.

/**
 * UPDATE first, then drop the old tokens. wrangler sends both in one execute;
 * if the DELETE were to fail alone, the new secret is live and old tokens die
 * at their TTL, and the CLI reports the failure, so re-running rotate is safe.
 */
export async function rotateClientSql(id: string, secret: string): Promise<string> {
	assertClientId(id);
	return `UPDATE clients SET secret_hash = ${sqlString(await sha256Hex(secret))} WHERE id = ${sqlString(id)} RETURNING id; DELETE FROM client_tokens WHERE client_id = ${sqlString(id)};`;
}

/**
 * Replace whichever of scopes and redirect URIs is non-empty, keeping the
 * secret. A scope change drops the tokens issued under the old scopes.
 */
export function updateClientSql(opts: {
	id: string;
	scopes: Scope[];
	redirectUris: string[];
}): string {
	assertClientId(opts.id);
	assertScopes(opts.scopes);
	opts.redirectUris.forEach(assertRedirectUri);
	const sets: string[] = [];
	if (opts.scopes.length > 0) {
		sets.push(`scopes = ${sqlString(JSON.stringify(opts.scopes))}`);
	}
	if (opts.redirectUris.length > 0) {
		sets.push(`redirect_uris = ${sqlString(JSON.stringify(opts.redirectUris))}`);
	}
	if (sets.length === 0) {
		throw new Error('nothing to update: pass at least one --scope or --redirect-uri');
	}
	const id = sqlString(opts.id);
	const dropTokens =
		opts.scopes.length > 0 ? ` DELETE FROM client_tokens WHERE client_id = ${id};` : '';
	return `UPDATE clients SET ${sets.join(', ')} WHERE id = ${id} RETURNING id;${dropTokens}`;
}

export function deleteClientSql(id: string): string {
	assertClientId(id);
	return `DELETE FROM client_tokens WHERE client_id = ${sqlString(id)}; DELETE FROM clients WHERE id = ${sqlString(id)} RETURNING id;`;
}

/** Rows returned across every statement of `wrangler d1 execute --json` output. */
export function returnedRowCount(wranglerJson: string): number {
	const parsed: unknown = JSON.parse(wranglerJson);
	if (!Array.isArray(parsed)) {
		throw new Error('unexpected wrangler output: not a JSON array');
	}
	return parsed.reduce((n: number, statement: { results?: unknown }) => {
		if (!Array.isArray(statement?.results)) {
			throw new Error('unexpected wrangler output: statement without results');
		}
		return n + statement.results.length;
	}, 0);
}

export const LIST_CLIENTS_SQL =
	'SELECT id, scopes, redirect_uris, created_at FROM clients ORDER BY id;';

function assertGrant(cid: string, role: string): void {
	if (!CID.test(cid)) {
		throw new Error(`invalid cid "${cid}"`);
	}
	if (!ROLE_NAME.test(role)) {
		throw new Error(`invalid role "${role}": use app:permission`);
	}
}

export function grantRoleSql(cid: string, role: string, now: number): string {
	assertGrant(cid, role);
	assertTimestamp(now);
	return `INSERT INTO user_roles (cid, role, source, granted_at) VALUES (${sqlString(cid)}, ${sqlString(role)}, 'cli', ${now}) ON CONFLICT DO NOTHING RETURNING cid;`;
}

export function revokeRoleSql(cid: string, role: string): string {
	assertGrant(cid, role);
	return `DELETE FROM user_roles WHERE cid = ${sqlString(cid)} AND role = ${sqlString(role)} AND source = 'cli' RETURNING cid;`;
}
