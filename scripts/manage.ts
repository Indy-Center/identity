// scripts/manage.ts
// npm run client -- create <id> [--scope users:read] [--scope users:write] [--redirect-uri <url>]… [--local]
// npm run client -- rotate <id> [--local]
// npm run client -- delete <id> [--local | --yes]
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
	returnedRowCount,
	revokeRoleSql,
	rotateClientSql
} from './manage-sql.ts';

const USAGE = `usage:
  npm run client -- create <id> [--scope users:read|users:write]… [--redirect-uri <url>]… [--local]
  npm run client -- rotate <id> [--local]
  npm run client -- delete <id> [--local | --yes]
  npm run client -- list [--local]
  npm run role   -- grant <cid> <role> [--local]
  npm run role   -- revoke <cid> <role> [--local]

Targets the REMOTE id_db unless --local is given. A remote delete needs --yes.`;

class UsageError extends Error {}

function d1(sql: string, local: boolean): string {
	return execFileSync(
		'npx',
		[
			'wrangler',
			'd1',
			'execute',
			'id_db',
			local ? '--local' : '--remote',
			'--command',
			sql,
			'--json'
		],
		{ encoding: 'utf8', stdio: ['inherit', 'pipe', 'inherit'] }
	);
}

function printSecret(id: string, secret: string): void {
	console.log(
		`\nclient_id:     ${id}\nclient_secret: ${secret}\n\nStore this secret now; it cannot be shown again.`
	);
}

async function main(): Promise<void> {
	let parsed;
	try {
		parsed = parseArgs({
			allowPositionals: true,
			options: {
				scope: { type: 'string', multiple: true, default: [] },
				'redirect-uri': { type: 'string', multiple: true, default: [] },
				local: { type: 'boolean', default: false },
				yes: { type: 'boolean', default: false },
				help: { type: 'boolean', short: 'h', default: false }
			}
		});
	} catch (err) {
		throw new UsageError(err instanceof Error ? err.message : String(err));
	}
	const { values, positionals } = parsed;
	const [kind, action, ...args] = positionals;
	if (values.help || !kind || !action) {
		console.log(USAGE);
		return;
	}
	const run = (sql: string) => d1(sql, values.local);
	const where = values.local ? 'local' : 'REMOTE';

	if (kind === 'client') {
		const id = args[0];
		if (action === 'list') {
			console.log(run(LIST_CLIENTS_SQL));
			return;
		}
		if (!id) {
			throw new UsageError(`missing <id>`);
		}
		if (action === 'create') {
			const secret = generateClientSecret(id);
			run(
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
			const changed = returnedRowCount(run(await rotateClientSql(id, secret)));
			if (changed !== 1) {
				throw new Error(`no client "${id}" in ${where} id_db; nothing rotated`);
			}
			return printSecret(id, secret);
		}
		if (action === 'delete') {
			const sql = deleteClientSql(id);
			if (!values.local && !values.yes) {
				throw new Error(
					`would delete client "${id}" and all its tokens from REMOTE id_db:\n  ${sql}\nre-run with --yes to do it`
				);
			}
			if (returnedRowCount(run(sql)) !== 1) {
				throw new Error(`no client "${id}" in ${where} id_db; nothing deleted`);
			}
			console.log(`deleted client "${id}" from ${where} id_db`);
			return;
		}
	}
	if (kind === 'role') {
		const [cid, role] = args;
		if (!cid || !role) {
			throw new UsageError('missing <cid> or <role>');
		}
		if (action === 'grant') {
			const added = returnedRowCount(run(grantRoleSql(cid, role, Date.now())));
			console.log(
				added === 1
					? `granted ${role} to ${cid} in ${where} id_db`
					: `${cid} already had a cli grant of ${role} in ${where} id_db`
			);
			return;
		}
		if (action === 'revoke') {
			if (returnedRowCount(run(revokeRoleSql(cid, role))) !== 1) {
				throw new Error(`${cid} has no cli grant of ${role} in ${where} id_db; nothing revoked`);
			}
			console.log(`revoked ${role} from ${cid} in ${where} id_db`);
			return;
		}
	}
	throw new UsageError(`unknown command "${kind} ${action}"`);
}

main().catch((err: unknown) => {
	console.error(err instanceof Error ? err.message : err);
	if (err instanceof UsageError) {
		console.error(`\n${USAGE}`);
	}
	process.exit(1);
});
