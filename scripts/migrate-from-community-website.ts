#!/usr/bin/env node
// Usage:
//   node --experimental-strip-types scripts/migrate-from-community-website.ts \
//     --users path/to/users.json --roles path/to/user_roles.json --out migration.sql
//
// Then apply with: wrangler d1 execute identity_db --file migration.sql --remote

import { readFile, writeFile } from 'node:fs/promises';
import type { CWUser, CWUserRole } from './types';
export { buildUserInserts, buildRoleInserts } from './transforms';
import { buildUserInserts, buildRoleInserts } from './transforms';

async function main() {
	const args = parseArgs(process.argv.slice(2));
	const users = JSON.parse(await readFile(args.users, 'utf8')) as CWUser[];
	const roles = JSON.parse(await readFile(args.roles, 'utf8')) as CWUserRole[];

	const userStmts = buildUserInserts(users, Date.now);
	const roleStmts = buildRoleInserts(roles, Date.now);
	const sql = ['BEGIN TRANSACTION;', ...userStmts, ...roleStmts, 'COMMIT;'].join('\n');
	await writeFile(args.out, sql);
	console.log(`users: ${users.length} → ${userStmts.length}`);
	console.log(`roles: ${roles.length} → ${roleStmts.length}`);
	if (users.length !== userStmts.length || roles.length !== roleStmts.length) {
		console.error('row count mismatch — bailing');
		process.exit(1);
	}
}

function parseArgs(argv: string[]): { users: string; roles: string; out: string } {
	const out: Record<string, string> = {};
	for (let i = 0; i < argv.length; i += 2) {
		const k = argv[i]?.replace(/^--/, '');
		const v = argv[i + 1];
		if (k && v) out[k] = v;
	}
	if (!out.users || !out.roles || !out.out) {
		console.error('usage: --users <path> --roles <path> --out <path>');
		process.exit(2);
	}
	return out as { users: string; roles: string; out: string };
}

if (import.meta.url === `file://${process.argv[1]}`) {
	main();
}
