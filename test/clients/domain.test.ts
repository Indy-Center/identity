import { env } from 'cloudflare:workers';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { sha256Hex } from '../../src/crypto';
import { makeDb } from '../../src/db';
import { clients, clientTokens } from '../../src/schema';
import {
	CLIENT_TOKEN_LIFETIME_MS,
	authenticateClient,
	grantScopes,
	hasScope,
	issueClientToken,
	revokeClientToken,
	validateClientToken
} from '../../src/clients/domain';
import { seedClient } from '../helpers/fixtures';

const db = () => makeDb(env.DB);

beforeEach(async () => {
	await db().delete(clientTokens);
	await db().delete(clients);
});
afterEach(() => vi.useRealTimers());

describe('authenticateClient', () => {
	it('accepts the right secret only', async () => {
		const secret = await seedClient(db(), 'community', { scopes: ['users:write'] });
		expect((await authenticateClient(db(), 'community', secret))?.id).toBe('community');
		expect(await authenticateClient(db(), 'community', 'wrong')).toBeNull();
		expect(await authenticateClient(db(), 'nobody', secret)).toBeNull();
	});
});

describe('scopes', () => {
	it('grants all, a subset, or nothing', () => {
		expect(grantScopes(['users:read', 'users:write'], undefined)).toEqual([
			'users:read',
			'users:write'
		]);
		expect(grantScopes(['users:read', 'users:write'], 'users:read')).toEqual(['users:read']);
		expect(grantScopes(['users:write'], 'users:read')).toEqual(['users:read']);
		expect(grantScopes(['users:read'], 'users:write')).toBeNull();
		expect(grantScopes(['users:read'], 'bogus')).toBeNull();
	});

	it('write implies read', () => {
		expect(hasScope(['users:write'], 'users:read')).toBe(true);
		expect(hasScope(['users:read'], 'users:write')).toBe(false);
	});
});

describe('client tokens', () => {
	it('issues, validates, and revokes', async () => {
		await seedClient(db(), 'bot', { scopes: ['users:read'] });
		const { token, expiresIn, scopes } = await issueClientToken(db(), 'bot', ['users:read']);
		expect(expiresIn).toBe(3600);
		expect(scopes).toEqual(['users:read']);
		expect(await validateClientToken(db(), token)).toEqual({
			clientId: 'bot',
			scopes: ['users:read']
		});
		await revokeClientToken(db(), token);
		expect(await validateClientToken(db(), token)).toBeNull();
	});

	it('revokes only the given token', async () => {
		await seedClient(db(), 'bot', { scopes: ['users:read'] });
		const first = await issueClientToken(db(), 'bot', ['users:read']);
		const second = await issueClientToken(db(), 'bot', ['users:read']);
		await revokeClientToken(db(), first.token);
		expect(await validateClientToken(db(), first.token)).toBeNull();
		expect(await validateClientToken(db(), second.token)).toEqual({
			clientId: 'bot',
			scopes: ['users:read']
		});
	});

	it('expires after an hour; the next issue deletes the expired row', async () => {
		await seedClient(db(), 'bot', { scopes: ['users:read'] });
		const { token } = await issueClientToken(db(), 'bot', ['users:read']);
		vi.useFakeTimers({ now: Date.now() + CLIENT_TOKEN_LIFETIME_MS + 1 });
		expect(await validateClientToken(db(), token)).toBeNull();
		const fresh = await issueClientToken(db(), 'bot', ['users:read']);
		const rows = await db().select({ id: clientTokens.id }).from(clientTokens).all();
		expect(rows).toEqual([{ id: await sha256Hex(fresh.token) }]);
	});
});
