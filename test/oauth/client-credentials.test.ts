import { env, exports } from 'cloudflare:workers';
import { beforeEach, describe, expect, it } from 'vitest';
import { makeDb } from '../../src/db';
import { clients, clientTokens } from '../../src/schema';
import { validateClientToken } from '../../src/clients/domain';
import { seedClient } from '../helpers/fixtures';

const TOKEN_URL = 'https://id.flyindycenter.com/oauth/token';
const db = () => makeDb(env.DB);

beforeEach(async () => {
	await db().delete(clientTokens);
	await db().delete(clients);
});

function post(fields: Record<string, string>, headers: Record<string, string> = {}) {
	return exports.default.fetch(TOKEN_URL, {
		method: 'POST',
		headers: { 'Content-Type': 'application/x-www-form-urlencoded', ...headers },
		body: new URLSearchParams(fields).toString()
	});
}

const basic = (id: string, secret: string) => ({
	Authorization: `Basic ${btoa(`${id}:${secret}`)}`
});

describe('POST /oauth/token grant_type=client_credentials', () => {
	it('issues a token with all of the client scopes (Basic)', async () => {
		const secret = await seedClient(db(), 'community', { scopes: ['users:read', 'users:write'] });
		const res = await post({ grant_type: 'client_credentials' }, basic('community', secret));
		expect(res.status).toBe(200);
		expect(res.headers.get('Cache-Control')).toBe('no-store');
		const body = (await res.json()) as Record<string, unknown>;
		expect(body).toMatchObject({
			token_type: 'Bearer',
			expires_in: 3600,
			scope: 'users:read users:write'
		});
		expect(await validateClientToken(db(), body.access_token as string)).toEqual({
			clientId: 'community',
			scopes: ['users:read', 'users:write']
		});
	});

	it('honors a requested subset (client_secret_post)', async () => {
		const secret = await seedClient(db(), 'bot', { scopes: ['users:read', 'users:write'] });
		const res = await post({
			grant_type: 'client_credentials',
			client_id: 'bot',
			client_secret: secret,
			scope: 'users:read'
		});
		expect(res.status).toBe(200);
		expect(((await res.json()) as { scope: string }).scope).toBe('users:read');
	});

	it('rejects a scope the client does not hold', async () => {
		const secret = await seedClient(db(), 'bot', { scopes: ['users:read'] });
		const res = await post(
			{ grant_type: 'client_credentials', scope: 'users:write' },
			basic('bot', secret)
		);
		expect(res.status).toBe(400);
		expect(res.headers.get('Cache-Control')).toBe('no-store');
		expect(((await res.json()) as { error: string }).error).toBe('invalid_scope');
	});

	it('rejects a client with no scopes rather than issue an empty token', async () => {
		const secret = await seedClient(db(), 'moodle', { scopes: [] });
		const res = await post({ grant_type: 'client_credentials' }, basic('moodle', secret));
		expect(res.status).toBe(400);
		expect(((await res.json()) as { error: string }).error).toBe('invalid_scope');
		expect(await db().select().from(clientTokens).all()).toHaveLength(0);
	});

	it('rejects bad or missing credentials with 401 invalid_client', async () => {
		await seedClient(db(), 'bot', { scopes: ['users:read'] });
		for (const res of [
			await post({ grant_type: 'client_credentials' }, basic('bot', 'wrong')),
			await post({ grant_type: 'client_credentials', client_id: 'bot', client_secret: 'wrong' }),
			await post({ grant_type: 'client_credentials', client_id: 'bot' }),
			await post({ grant_type: 'client_credentials' })
		]) {
			expect(res.status).toBe(401);
			expect(res.headers.get('Cache-Control')).toBe('no-store');
			expect(res.headers.get('WWW-Authenticate')).toBe('Basic realm="identity"');
			expect(((await res.json()) as { error: string }).error).toBe('invalid_client');
		}
		expect(await db().select().from(clientTokens).all()).toHaveLength(0);
	});
});
