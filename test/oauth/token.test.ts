import { env, exports } from 'cloudflare:workers';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { eq } from 'drizzle-orm';
import { makeDb } from '../../src/db';
import { authorizationCodes, clients, sessions, users } from '../../src/schema';
import { setUserActive, upsertFromVatsim } from '../../src/users/domain';
import { validateSession } from '../../src/sessions/domain';
import { createAuthorizationCode } from '../../src/oauth/codes';
import { sha256Hex } from '../../src/crypto';
import { makeVatsimProfile, seedClient } from '../helpers/fixtures';

const TOKEN_URL = 'https://id.flyindycenter.com/oauth/token';
const REDIRECT = 'http://localhost:5173/kind';

beforeEach(async () => {
	const db = makeDb(env.DB);
	await db.delete(authorizationCodes);
	await db.delete(sessions);
	await db.delete(users);
	await db.delete(clients);
});

afterEach(() => {
	vi.restoreAllMocks();
});

async function seedCode(
	redirectUri = REDIRECT,
	clientId = 'charts'
): Promise<{ cid: string; code: string }> {
	const db = makeDb(env.DB);
	const { cid } = await upsertFromVatsim(db, makeVatsimProfile({ cid: '1' }));
	const code = await createAuthorizationCode(db, cid, redirectUri, clientId);
	return { cid, code };
}

function postToken(
	fields: Record<string, string>,
	headers: Record<string, string> = {}
): Promise<Response> {
	return exports.default.fetch(TOKEN_URL, {
		method: 'POST',
		headers: { 'Content-Type': 'application/x-www-form-urlencoded', ...headers },
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
		const { cid, code } = await seedCode();
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
		expect((await validateSession(db, body.access_token))?.cid).toBe(cid);

		const [row] = await db.select().from(sessions).where(eq(sessions.cid, cid));
		const expectedExpiresIn = (row!.expiresAt - Date.now()) / 1000;
		expect(Math.abs(body.expires_in - expectedExpiresIn)).toBeLessThan(2);
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
		const { cid } = await upsertFromVatsim(db, makeVatsimProfile({ cid: '2' }));
		const now = Date.now();
		await db.insert(authorizationCodes).values({
			id: await sha256Hex('expiredcode'),
			cid,
			clientId: 'charts',
			redirectUri: REDIRECT,
			expiresAt: now - 1000,
			createdAt: now - 61_000
		});

		await expectOAuthError(await exchange('expiredcode'), 'invalid_grant');
		expect(await db.select().from(authorizationCodes).all()).toHaveLength(0);
		expect(await db.select().from(sessions).all()).toHaveLength(0);
	});

	it('rejects a code for a disabled user with invalid_grant', async () => {
		const db = makeDb(env.DB);
		const { cid, code } = await seedCode();
		await setUserActive(db, cid, false, { reason: 'test' });
		await expectOAuthError(await exchange(code), 'invalid_grant');
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

	it('rejects a missing grant_type with invalid_request (RFC 6749 §5.2)', async () => {
		const { code } = await seedCode();
		await expectOAuthError(
			await postToken({ code, redirect_uri: REDIRECT, client_id: 'charts' }),
			'invalid_request'
		);
	});

	it('rejects a body that fails to parse with invalid_request, not a 500', async () => {
		const stream = new ReadableStream({
			start(controller) {
				controller.error(new Error('client disconnected'));
			}
		});
		const res = await exports.default.fetch(TOKEN_URL, {
			method: 'POST',
			headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
			body: stream,
			// @ts-expect-error duplex is required by fetch for a streaming body,
			// but missing from the lib.dom RequestInit type used here.
			duplex: 'half'
		});
		await expectOAuthError(res, 'invalid_request');
	});

	it('rejects a missing field with invalid_request', async () => {
		const { code } = await seedCode();
		await expectOAuthError(
			await postToken({ grant_type: 'authorization_code', code, redirect_uri: REDIRECT }),
			'invalid_request'
		);
	});

	it('accepts a case-varied form Content-Type with parameters', async () => {
		const { cid, code } = await seedCode();
		const res = await exports.default.fetch(TOKEN_URL, {
			method: 'POST',
			headers: { 'Content-Type': 'Application/X-WWW-Form-Urlencoded; charset=UTF-8' },
			body: new URLSearchParams({
				grant_type: 'authorization_code',
				code,
				redirect_uri: REDIRECT,
				client_id: 'charts'
			}).toString()
		});
		expect(res.status).toBe(200);
		const db = makeDb(env.DB);
		const body = (await res.json()) as { access_token: string };
		expect((await validateSession(db, body.access_token))?.cid).toBe(cid);
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

describe('POST /oauth/token for a registered client', () => {
	const MOODLE_REDIRECT = 'https://moodle.example.org/admin/oauth2callback.php';
	const basic = (id: string, secret: string) => ({
		Authorization: `Basic ${btoa(`${id}:${secret}`)}`
	});

	async function expectInvalidClient(res: Response) {
		expect(res.status).toBe(401);
		expect(res.headers.get('Cache-Control')).toBe('no-store');
		expect(res.headers.get('WWW-Authenticate')).toBe('Basic realm="identity"');
		expect(((await res.json()) as { error: string }).error).toBe('invalid_client');
	}

	it('requires and accepts the client secret (client_secret_post)', async () => {
		const db = makeDb(env.DB);
		const secret = await seedClient(db, 'moodle', { redirectUris: [MOODLE_REDIRECT] });
		const { cid, code } = await seedCode(MOODLE_REDIRECT, 'moodle');
		const res = await postToken({
			grant_type: 'authorization_code',
			code,
			redirect_uri: MOODLE_REDIRECT,
			client_id: 'moodle',
			client_secret: secret
		});
		expect(res.status).toBe(200);
		const body = (await res.json()) as { access_token: string };
		expect((await validateSession(db, body.access_token))?.cid).toBe(cid);
	});

	it('accepts the client secret via client_secret_basic', async () => {
		const db = makeDb(env.DB);
		const secret = await seedClient(db, 'moodle', { redirectUris: [MOODLE_REDIRECT] });
		const { code } = await seedCode(MOODLE_REDIRECT, 'moodle');
		const res = await postToken(
			{ grant_type: 'authorization_code', code, redirect_uri: MOODLE_REDIRECT },
			basic('moodle', secret)
		);
		expect(res.status).toBe(200);
	});

	it('rejects a registered client without its secret', async () => {
		const db = makeDb(env.DB);
		await seedClient(db, 'moodle', { redirectUris: [MOODLE_REDIRECT] });
		const { code } = await seedCode(MOODLE_REDIRECT, 'moodle');
		await expectInvalidClient(
			await postToken({
				grant_type: 'authorization_code',
				code,
				redirect_uri: MOODLE_REDIRECT,
				client_id: 'moodle'
			})
		);
		expect(await db.select().from(sessions).all()).toHaveLength(0);
	});

	it('rejects a registered client with a wrong secret', async () => {
		const db = makeDb(env.DB);
		await seedClient(db, 'moodle', { redirectUris: [MOODLE_REDIRECT] });
		const { code } = await seedCode(MOODLE_REDIRECT, 'moodle');
		await expectInvalidClient(
			await postToken(
				{ grant_type: 'authorization_code', code, redirect_uri: MOODLE_REDIRECT },
				basic('moodle', 'wrong')
			)
		);
	});

	it('rejects a secret presented for an unregistered client_id', async () => {
		const { code } = await seedCode();
		await expectInvalidClient(
			await postToken({
				grant_type: 'authorization_code',
				code,
				redirect_uri: REDIRECT,
				client_id: 'charts',
				client_secret: 'anything'
			})
		);
	});

	it('rejects a code issued to another client', async () => {
		const { code } = await seedCode(REDIRECT, 'charts');
		await expectOAuthError(
			await postToken({
				grant_type: 'authorization_code',
				code,
				redirect_uri: REDIRECT,
				client_id: 'other'
			}),
			'invalid_grant'
		);
	});

	it("rejects client B's code redeemed with client A's valid credentials", async () => {
		const db = makeDb(env.DB);
		const secretA = await seedClient(db, 'a', { redirectUris: [MOODLE_REDIRECT] });
		await seedClient(db, 'b', { redirectUris: [MOODLE_REDIRECT] });
		const { code } = await seedCode(MOODLE_REDIRECT, 'b');
		await expectOAuthError(
			await postToken(
				{ grant_type: 'authorization_code', code, redirect_uri: MOODLE_REDIRECT },
				basic('a', secretA)
			),
			'invalid_grant'
		);
		expect(await db.select().from(sessions).all()).toHaveLength(0);
	});

	it('rejects a form client_id that differs from the Basic credentials', async () => {
		const db = makeDb(env.DB);
		const secretA = await seedClient(db, 'a', { redirectUris: [MOODLE_REDIRECT] });
		const { code } = await seedCode(MOODLE_REDIRECT, 'b');
		await expectOAuthError(
			await postToken(
				{ grant_type: 'authorization_code', code, redirect_uri: MOODLE_REDIRECT, client_id: 'b' },
				basic('a', secretA)
			),
			'invalid_request'
		);
	});

	it('rejects a malformed Basic header with 401 invalid_client', async () => {
		const { code } = await seedCode();
		await expectInvalidClient(
			await postToken(
				{ grant_type: 'authorization_code', code, redirect_uri: REDIRECT, client_id: 'charts' },
				{ Authorization: 'Basic !!!' }
			)
		);
	});

	it('rejects Basic plus a form client_secret with invalid_request', async () => {
		const db = makeDb(env.DB);
		const secret = await seedClient(db, 'moodle', { redirectUris: [MOODLE_REDIRECT] });
		const { code } = await seedCode(MOODLE_REDIRECT, 'moodle');
		await expectOAuthError(
			await postToken(
				{
					grant_type: 'authorization_code',
					code,
					redirect_uri: MOODLE_REDIRECT,
					client_secret: secret
				},
				basic('moodle', secret)
			),
			'invalid_request'
		);
	});
});
