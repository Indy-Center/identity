import { describe, expect, it } from 'vitest';
import { buildUserInserts, buildRoleInserts } from '../../scripts/migrate-from-community-website';

describe('buildUserInserts', () => {
	it('preserves UUIDs, copies fields, sets created/updated to now()', () => {
		const stmts = buildUserInserts(
			[
				{
					id: 'uuid-1',
					cid: '111',
					email: 'a@b.com',
					first_name: 'A',
					last_name: 'B',
					preferred_name: null,
					pronouns: null,
					discord_id: null,
					data: '{"x":1}'
				}
			],
			() => 1700000000000
		);
		expect(stmts).toHaveLength(1);
		expect(stmts[0]).toContain('INSERT INTO users');
		expect(stmts[0]).toContain("'uuid-1'");
		expect(stmts[0]).toContain("'111'");
		expect(stmts[0]).toContain("'a@b.com'");
		expect(stmts[0]).toContain('1700000000000');
	});

	it('escapes single quotes in input strings', () => {
		const stmts = buildUserInserts(
			[
				{
					id: 'u',
					cid: '1',
					email: "it's@me.com",
					first_name: "O'Brien",
					last_name: 'X',
					data: '{}'
				}
			],
			() => 0
		);
		expect(stmts[0]).toContain("'it''s@me.com'");
		expect(stmts[0]).toContain("'O''Brien'");
	});
});

describe('buildRoleInserts', () => {
	it('emits inserts with granted_at=now and granted_by=migration:initial', () => {
		const stmts = buildRoleInserts([{ user_id: 'u1', role: 'zid:admin' }], () => 42);
		expect(stmts[0]).toContain('INSERT INTO user_roles');
		expect(stmts[0]).toContain("'u1'");
		expect(stmts[0]).toContain("'zid:admin'");
		expect(stmts[0]).toContain('42');
		expect(stmts[0]).toContain("'migration:initial'");
	});
});
