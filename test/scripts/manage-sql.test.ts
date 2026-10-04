import { describe, expect, it } from 'vitest';
import { sha256Hex } from '../../src/crypto';
import {
	createClientSql,
	deleteClientSql,
	generateClientSecret,
	grantRoleSql,
	returnedRowCount,
	revokeRoleSql,
	rotateClientSql,
	sqlString,
	updateClientSql
} from '../../scripts/manage-sql';

describe('manage-sql', () => {
	it('generates prefixed secrets from 32 random bytes', () => {
		const a = generateClientSecret('community');
		expect(a).toMatch(/^community_[a-z2-7]{52}$/);
		expect(generateClientSecret('community')).not.toBe(a);
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
			await createClientSql({
				id: 'bot',
				secret: 'b',
				scopes: ['users:read'],
				redirectUris: [],
				now: 1
			})
		).toContain(`NULL, '["users:read"]', 1);`);
		expect(
			await createClientSql({
				id: 'app',
				secret: 'a',
				scopes: [],
				redirectUris: ['http://localhost:5173/cb'],
				now: 1
			})
		).toContain(`'["http://localhost:5173/cb"]', '[]', 1);`);
	});

	it('refuses a client with neither scopes nor redirect URIs', async () => {
		await expect(
			createClientSql({ id: 'bot', secret: 'b', scopes: [], redirectUris: [], now: 1 })
		).rejects.toThrow(/at least one --scope or --redirect-uri/);
	});

	it('validates redirect URIs', async () => {
		const create = (uri: string) =>
			createClientSql({ id: 'x', secret: 's', scopes: [], redirectUris: [uri], now: 1 });
		for (const ok of [
			'https://moodle.example.org/cb',
			'https://m.example.org/cb?x=1',
			'http://localhost/cb',
			'http://127.0.0.1:8080/cb',
			'http://[::1]:3000/cb'
		]) {
			await expect(create(ok), ok).resolves.toContain('INSERT INTO clients');
		}
		for (const bad of [
			'http://moodle.example.org/cb',
			'http://localhost.evil.org/cb',
			'https:moodle.example.org/cb',
			'javascript:alert(1)',
			'/relative/cb',
			'https://m.example.org/cb#frag',
			'https://m.example.org/c b',
			'https://m.example.org/cb\r\nSet-Cookie: x',
			'https://m.example.org/\u0000',
			'https://user:pw@m.example.org/cb',
			`https://m.example.org/${'a'.repeat(2048)}`
		]) {
			await expect(create(bad), bad).rejects.toThrow(/redirect uri/);
		}
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
			`UPDATE clients SET secret_hash = '${await sha256Hex('bot_new')}' WHERE id = 'bot' RETURNING id;`
		);
		expect(rotate).toContain("DELETE FROM client_tokens WHERE client_id = 'bot';");
		expect(deleteClientSql('bot')).toBe(
			"DELETE FROM client_tokens WHERE client_id = 'bot'; DELETE FROM clients WHERE id = 'bot' RETURNING id;"
		);
	});

	it('grants and revokes cli-sourced roles', () => {
		expect(grantRoleSql('1234567', 'global:admin', 9)).toBe(
			"INSERT INTO user_roles (cid, role, source, granted_at) VALUES ('1234567', 'global:admin', 'cli', 9) ON CONFLICT DO NOTHING RETURNING cid;"
		);
		expect(revokeRoleSql('1234567', 'global:admin')).toBe(
			"DELETE FROM user_roles WHERE cid = '1234567' AND role = 'global:admin' AND source = 'cli' RETURNING cid;"
		);
		for (const cid of ['abc', '0', '01', '', '12345678901', '-1', '1.5']) {
			expect(() => grantRoleSql(cid, 'global:admin', 1), cid).toThrow(/cid/);
			expect(() => revokeRoleSql(cid, 'global:admin'), cid).toThrow(/cid/);
		}
		expect(() => grantRoleSql('1', 'admin', 1)).toThrow(/role/);
		expect(() => grantRoleSql("1' OR '1'='1", 'global:admin', 1)).toThrow(/cid/);
		expect(() => revokeRoleSql('1', "global:admin' OR '1'='1")).toThrow(/role/);
		expect(() => grantRoleSql('1', 'global:admin', Number.NaN)).toThrow(/timestamp/);
	});

	it('counts rows returned in wrangler --json output', () => {
		const out = (...counts: number[]) =>
			JSON.stringify(
				counts.map((n) => ({
					results: Array.from({ length: n }, () => ({ id: 'bot' })),
					success: true,
					meta: { duration: 0 }
				}))
			);
		expect(returnedRowCount(out(1, 0))).toBe(1);
		expect(returnedRowCount(out(0, 0))).toBe(0);
		expect(returnedRowCount(out(0))).toBe(0);
		expect(() => returnedRowCount('{}')).toThrow(/unexpected/);
		expect(() => returnedRowCount('[{}]')).toThrow(/unexpected/);
		expect(() => returnedRowCount('not json')).toThrow();
	});

	it('update replaces only the lists given, dropping tokens on a scope change', () => {
		expect(updateClientSql({ id: 'bot', scopes: ['users:read'], redirectUris: [] })).toBe(
			`UPDATE clients SET scopes = '["users:read"]' WHERE id = 'bot' RETURNING id; DELETE FROM client_tokens WHERE client_id = 'bot';`
		);
		expect(
			updateClientSql({ id: 'bot', scopes: [], redirectUris: ['https://b.example.org/cb'] })
		).toBe(
			`UPDATE clients SET redirect_uris = '["https://b.example.org/cb"]' WHERE id = 'bot' RETURNING id;`
		);
		expect(() => updateClientSql({ id: 'bot', scopes: [], redirectUris: [] })).toThrow(
			/nothing to update/
		);
		expect(() =>
			updateClientSql({ id: 'bot', scopes: ['nope' as never], redirectUris: [] })
		).toThrow(/scope/);
		expect(() => updateClientSql({ id: "b'ot", scopes: ['users:read'], redirectUris: [] })).toThrow(
			/client id/
		);
	});
});
