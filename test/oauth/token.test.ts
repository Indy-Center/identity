import { env, exports } from 'cloudflare:workers';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { makeDb } from '../../src/db';
import { authorizationCodes, sessions, users } from '../../src/schema';
import { upsertFromVatsim } from '../../src/users/domain';
import { validateSession } from '../../src/sessions/domain';
import { createAuthorizationCode } from '../../src/authorization-codes/domain';
import { sha256Hex } from '../../src/crypto';
import { makeVatsimProfile } from '../helpers/fixtures';

const TOKEN_URL = 'https://auth.flyindycenter.com/oauth/token';
const REDIRECT = 'http://localhost:5173/kind';

beforeEach(async () => {
	const db = makeDb(env.DB);
	await db.delete(authorizationCodes);
	await db.delete(sessions);
	await db.delete(users);
});

afterEach(() => {
	vi.restoreAllMocks();
});

async function seedCode(redirectUri = REDIRECT): Promise<{ userId: string; code: string }> {
	const db = makeDb(env.DB);
	const { id: userId } = await upsertFromVatsim(db, makeVatsimProfile({ cid: '1' }));
	const { code } = await createAuthorizationCode(db, userId, redirectUri);
	return { userId, code };
}

function postToken(fields: Record<string, string>): Promise<Response> {
	return exports.default.fetch(TOKEN_URL, {
		method: 'POST',
		headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
		body: new URLSearchParams(fields).toString()
	});
}

function exchange(code: string, redirectUri = REDIRECT): Promise<Response> {
	return postToken({
		grant_type: 'authorization_code',
		code,
		redirect_uri: redirectUri,
		client_id: 'charts'
	});
}

async function expectOAuthError(res: Response, error: string) {
	expect(res.status).toBe(400);
	expect(res.headers.get('Cache-Control')).toBe('no-store');
	const body = (await res.json()) as { error: string; error_description?: string };
	expect(body.error).toBe(error);
	expect(body.error_description).toBeTruthy();
}

describe('POST /oauth/token', () => {
	it('exchanges a code for an access token that validates', async () => {
		const { userId, code } = await seedCode();
		const res = await exchange(code);
		expect(res.status).toBe(200);
		expect(res.headers.get('Cache-Control')).toBe('no-store');
		expect(res.headers.get('Pragma')).toBe('no-cache');

		const body = (await res.json()) as {
			access_token: string;
			token_type: string;
			expires_in: number;
		};
		expect(body.access_token).toMatch(/^[a-z2-7]{32}$/);
		expect(body.token_type).toBe('Bearer');
		// 30-day session, give or take the test's own runtime.
		expect(body.expires_in).toBeGreaterThan(30 * 24 * 60 * 60 - 60);
		expect(body.expires_in).toBeLessThanOrEqual(30 * 24 * 60 * 60);

		const db = makeDb(env.DB);
		expect((await validateSession(db, body.access_token))?.userId).toBe(userId);
	});

	it('rejects a second use with invalid_grant', async () => {
		const { code } = await seedCode();
		expect((await exchange(code)).status).toBe(200);
		await expectOAuthError(await exchange(code), 'invalid_grant');
	});

	it('rejects a mismatched redirect_uri with invalid_grant', async () => {
		const { code } = await seedCode();
		await expectOAuthError(await exchange(code, 'http://localhost:5173/other'), 'invalid_grant');
	});

	it('rejects an expired code with invalid_grant and prunes it', async () => {
		const db = makeDb(env.DB);
		const { id: userId } = await upsertFromVatsim(db, makeVatsimProfile({ cid: '2' }));
		const now = Date.now();
		await db.insert(authorizationCodes).values({
			id: await sha256Hex('expiredcode'),
			userId,
			redirectUri: REDIRECT,
			expiresAt: now - 1000,
			createdAt: now - 61_000
		});

		await expectOAuthError(await exchange('expiredcode'), 'invalid_grant');
		expect(await db.select().from(authorizationCodes).all()).toHaveLength(0);
		expect(await db.select().from(sessions).all()).toHaveLength(0);
	});

	it('rejects an unsupported grant_type', async () => {
		const { code } = await seedCode();
		await expectOAuthError(
			await postToken({
				grant_type: 'refresh_token',
				code,
				redirect_uri: REDIRECT,
				client_id: 'charts'
			}),
			'unsupported_grant_type'
		);
	});

	it('rejects a missing field with invalid_request', async () => {
		const { code } = await seedCode();
		await expectOAuthError(
			await postToken({ grant_type: 'authorization_code', code, redirect_uri: REDIRECT }),
			'invalid_request'
		);
	});

	it('rejects a JSON body with invalid_request', async () => {
		const { code } = await seedCode();
		const res = await exports.default.fetch(TOKEN_URL, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({
				grant_type: 'authorization_code',
				code,
				redirect_uri: REDIRECT,
				client_id: 'charts'
			})
		});
		await expectOAuthError(res, 'invalid_request');
	});
});
