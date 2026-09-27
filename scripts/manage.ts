// scripts/manage.ts
// npm run client -- create <id> [--scope users:read] [--scope users:write] [--redirect-uri <url>]… [--local]
// npm run client -- rotate <id> [--local]
// npm run client -- delete <id> [--local]
// npm run client -- list [--local]
// npm run role   -- grant|revoke <cid> <role> [--local]
//
// Runs SQL against id_db through wrangler (remote by default), so it needs
// Cloudflare access. Secrets are printed once and never stored in plaintext.
import { execFileSync } from 'node:child_process';
import { parseArgs } from 'node:util';
import type { Scope } from '../src/schema.ts';
import {
	LIST_CLIENTS_SQL,
	createClientSql,
	deleteClientSql,
	generateClientSecret,
	grantRoleSql,
	revokeRoleSql,
	rotateClientSql
} from './manage-sql.ts';

const USAGE = `usage:
  npm run client -- create <id> [--scope users:read|users:write]… [--redirect-uri <url>]… [--local]
  npm run client -- rotate <id> [--local]
  npm run client -- delete <id> [--local]
  npm run client -- list [--local]
  npm run role   -- grant <cid> <role> [--local]
  npm run role   -- revoke <cid> <role> [--local]`;

const { values, positionals } = parseArgs({
	allowPositionals: true,
	options: {
		scope: { type: 'string', multiple: true, default: [] },
		'redirect-uri': { type: 'string', multiple: true, default: [] },
		local: { type: 'boolean', default: false },
		help: { type: 'boolean', short: 'h', default: false }
	}
});

function d1(sql: string, json = false): void {
	execFileSync(
		'npx',
		[
			'wrangler',
			'd1',
			'execute',
			'id_db',
			values.local ? '--local' : '--remote',
			'--command',
			sql,
			...(json ? ['--json'] : [])
		],
		{ stdio: 'inherit' }
	);
}

function printSecret(id: string, secret: string): void {
	console.log(
		`\nclient_id:     ${id}\nclient_secret: ${secret}\n\nStore this secret now; it cannot be shown again.`
	);
}

async function main(): Promise<void> {
	const [kind, action, ...args] = positionals;
	if (values.help || !kind || !action) {
		console.log(USAGE);
		return;
	}
	if (kind === 'client') {
		const id = args[0];
		if (action === 'list') {
			return d1(LIST_CLIENTS_SQL, true);
		}
		if (!id) {
			throw new Error(USAGE);
		}
		if (action === 'create') {
			const secret = generateClientSecret(id);
			d1(
				await createClientSql({
					id,
					secret,
					scopes: values.scope as Scope[],
					redirectUris: values['redirect-uri'] as string[],
					now: Date.now()
				})
			);
			return printSecret(id, secret);
		}
		if (action === 'rotate') {
			const secret = generateClientSecret(id);
			d1(await rotateClientSql(id, secret));
			return printSecret(id, secret);
		}
		if (action === 'delete') {
			return d1(deleteClientSql(id));
		}
	}
	if (kind === 'role') {
		const [cid, role] = args;
		if (!cid || !role) {
			throw new Error(USAGE);
		}
		if (action === 'grant') {
			return d1(grantRoleSql(cid, role, Date.now()));
		}
		if (action === 'revoke') {
			return d1(revokeRoleSql(cid, role));
		}
	}
	throw new Error(USAGE);
}

main().catch((err: unknown) => {
	console.error(err instanceof Error ? err.message : err);
	process.exit(1);
});
