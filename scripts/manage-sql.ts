// scripts/manage-sql.ts
// Pure builders for scripts/manage.ts. Kept free of node: imports and
// extension-less paths so both Node (type stripping) and the workers test pool
// can import it.
import { randomBase32, sha256Hex } from '../src/crypto.ts';
import { LOOPBACK, REDIRECT_URI_MAX_LENGTH } from '../src/oauth/redirect-uri-rules.ts';
import { SCOPES, type Scope } from '../src/schema.ts';
import { ROLE_NAME } from '../src/users/role-name.ts';

const CLIENT_ID = /^[a-z0-9-]+$/;
// `cli` is the role source for grants made here; a client with that id could
// otherwise remove global:* rows through the API.
const RESERVED_CLIENT_IDS = new Set(['cli']);
// VATSIM CIDs: positive integers, no leading zeros (so '01' can't shadow '1').
const CID = /^[1-9]\d{0,9}$/;

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

/**
 * A redirect URI a registered client may use: an absolute https URL (or http on
 * loopback, as for the allowlist), no userinfo, no fragment (RFC 6749 §3.1.2),
 * no whitespace or control characters, at most REDIRECT_URI_MAX_LENGTH long.
 */
function assertRedirectUri(uri: string): void {
	const fail = (why: string) => {
		throw new Error(`invalid redirect uri "${uri}": ${why}`);
	};
	if (uri.length > REDIRECT_URI_MAX_LENGTH) {
		fail(`longer than ${REDIRECT_URI_MAX_LENGTH} characters`);
	}
	if (/[\s\p{Cc}]/u.test(uri)) {
		fail('contains whitespace or control characters');
	}
	if (uri.includes('#')) {
		fail('must not contain a fragment');
	}
	let url: URL;
	try {
		url = new URL(uri);
	} catch {
		return fail('not an absolute URL');
	}
	if (url.username || url.password) {
		fail('must not contain credentials');
	}
	const https = url.protocol === 'https:' && uri.startsWith('https://') && url.hostname !== '';
	if (!https && !LOOPBACK.test(uri)) {
		fail('must be https (http only on localhost, 127.0.0.1 or [::1])');
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
	opts.redirectUris.forEach(assertRedirectUri);
	if (opts.scopes.length === 0 && opts.redirectUris.length === 0) {
		throw new Error(
			'a client needs at least one --scope or --redirect-uri, else it can do nothing'
		);
	}
	const redirect =
		opts.redirectUris.length > 0 ? sqlString(JSON.stringify(opts.redirectUris)) : 'NULL';
	return `INSERT INTO clients (id, secret_hash, redirect_uris, scopes, created_at) VALUES (${sqlString(opts.id)}, ${sqlString(await hashSecret(opts.secret))}, ${redirect}, ${sqlString(JSON.stringify(opts.scopes))}, ${opts.now});`;
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
	return `UPDATE clients SET secret_hash = ${sqlString(await hashSecret(secret))} WHERE id = ${sqlString(id)} RETURNING id; DELETE FROM client_tokens WHERE client_id = ${sqlString(id)};`;
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
