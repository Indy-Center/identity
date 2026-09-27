// test/scripts/manage-sql.test.ts
import { describe, expect, it } from 'vitest';
import { sha256Hex } from '../../src/crypto';
import { RoleNameSchema } from '../../src/users/roles';
import {
	createClientSql,
	deleteClientSql,
	generateClientSecret,
	grantRoleSql,
	hashSecret,
	revokeRoleSql,
	rotateClientSql,
	sqlString
} from '../../scripts/manage-sql';

describe('manage-sql', () => {
	it('generates prefixed secrets from 32 random bytes', () => {
		const a = generateClientSecret('community');
		expect(a).toMatch(/^community_[a-z2-7]{52}$/);
		expect(generateClientSecret('community')).not.toBe(a);
	});

	it('hashes secrets exactly as authenticateClient does', async () => {
		const secret = generateClientSecret('community');
		expect(await hashSecret(secret)).toBe(await sha256Hex(secret));
	});

	it('escapes single quotes', () => {
		expect(sqlString("o'brien")).toBe("'o''brien'");
		expect(sqlString("''")).toBe("''''''");
	});

	it('builds a client insert with the secret hash', async () => {
		const sql = await createClientSql({
			id: 'moodle',
			secret: 'moodle_s',
			scopes: ['users:read'],
			redirectUris: ['https://m.example.org/cb'],
			now: 5
		});
		expect(sql).toBe(
			`INSERT INTO clients (id, secret_hash, redirect_uris, scopes, created_at) VALUES ('moodle', '${await sha256Hex('moodle_s')}', '["https://m.example.org/cb"]', '["users:read"]', 5);`
		);
		expect(
			await createClientSql({ id: 'bot', secret: 'b', scopes: [], redirectUris: [], now: 1 })
		).toContain("NULL, '[]', 1);");
	});

	it('escapes quotes inside redirect URIs', async () => {
		const sql = await createClientSql({
			id: 'x',
			secret: 's',
			scopes: [],
			redirectUris: ["https://x.example.org/cb?a='1"],
			now: 1
		});
		expect(sql).toContain(`'["https://x.example.org/cb?a=''1"]'`);
	});

	it('validates ids and scopes', async () => {
		await expect(
			createClientSql({ id: 'Bad_Id', secret: 's', scopes: [], redirectUris: [], now: 1 })
		).rejects.toThrow(/client id/);
		await expect(
			createClientSql({
				id: 'ok',
				secret: 's',
				scopes: ['users:admin' as never],
				redirectUris: [],
				now: 1
			})
		).rejects.toThrow(/scope/);
	});

	it('rejects ids that could collide with other role sources or break out of SQL', async () => {
		for (const id of ['cli', 'user:1', "a'b", "x'); DROP TABLE clients; --", '', 'a b']) {
			expect(() => generateClientSecret(id)).toThrow(/client id/);
			expect(() => deleteClientSql(id)).toThrow(/client id/);
			await expect(rotateClientSql(id, 's')).rejects.toThrow(/client id/);
			await expect(
				createClientSql({ id, secret: 's', scopes: [], redirectUris: [], now: 1 })
			).rejects.toThrow(/client id/);
		}
		expect(() => generateClientSecret('cli')).toThrow(/reserved/);
	});

	it('rotate replaces the hash and kills tokens; delete removes both', async () => {
		const rotate = await rotateClientSql('bot', 'bot_new');
		expect(rotate).toContain(
			`UPDATE clients SET secret_hash = '${await sha256Hex('bot_new')}' WHERE id = 'bot';`
		);
		expect(rotate).toContain("DELETE FROM client_tokens WHERE client_id = 'bot';");
		expect(deleteClientSql('bot')).toBe(
			"DELETE FROM client_tokens WHERE client_id = 'bot'; DELETE FROM clients WHERE id = 'bot';"
		);
	});

	it('grants and revokes cli-sourced roles', () => {
		expect(grantRoleSql('1234567', 'global:admin', 9)).toBe(
			"INSERT INTO user_roles (cid, role, source, granted_at) VALUES ('1234567', 'global:admin', 'cli', 9) ON CONFLICT DO NOTHING;"
		);
		expect(revokeRoleSql('1234567', 'global:admin')).toBe(
			"DELETE FROM user_roles WHERE cid = '1234567' AND role = 'global:admin' AND source = 'cli';"
		);
		expect(() => grantRoleSql('abc', 'global:admin', 1)).toThrow(/cid/);
		expect(() => grantRoleSql('1', 'admin', 1)).toThrow(/role/);
		expect(() => grantRoleSql("1' OR '1'='1", 'global:admin', 1)).toThrow(/cid/);
		expect(() => revokeRoleSql('1', "global:admin' OR '1'='1")).toThrow(/role/);
		expect(() => grantRoleSql('1', 'global:admin', Number.NaN)).toThrow(/timestamp/);
	});

	it('accepts exactly the role names the API accepts', () => {
		const samples = [
			'global:admin',
			'events:can_sign_up',
			'a-b:c.d',
			'admin',
			'Global:admin',
			'a:b:c',
			'a:*',
			"a:b'",
			'a :b',
			':b',
			'a:'
		];
		for (const role of samples) {
			const api = RoleNameSchema.safeParse(role).success;
			if (api) {
				expect(() => grantRoleSql('1', role, 1)).not.toThrow();
			} else {
				expect(() => grantRoleSql('1', role, 1)).toThrow(/role/);
			}
		}
	});
});
