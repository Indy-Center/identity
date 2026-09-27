import { env } from 'cloudflare:workers';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { makeDb } from '../../src/db';
import { authorizationCodes, sessions, users } from '../../src/schema';
import { setUserActive, upsertFromVatsim } from '../../src/users/domain';
import { validateSession } from '../../src/sessions/domain';
import {
	AUTHORIZATION_CODE_LIFETIME_MS,
	createAuthorizationCode,
	exchangeAuthorizationCode
} from '../../src/oauth/codes';
import { makeVatsimProfile } from '../helpers/fixtures';

const REDIRECT = 'https://charts.flyindycenter.com/kind';

beforeEach(async () => {
	const db = makeDb(env.DB);
	await db.delete(authorizationCodes);
	await db.delete(sessions);
	await db.delete(users);
});

afterEach(() => {
	vi.useRealTimers();
});

async function seedUser(): Promise<string> {
	const db = makeDb(env.DB);
	const user = await upsertFromVatsim(db, makeVatsimProfile({ cid: '1' }));
	return user.id;
}

describe('authorization codes', () => {
	it('stores only the hash of the code, with the redirect URI', async () => {
		const db = makeDb(env.DB);
		const userId = await seedUser();
		const { code } = await createAuthorizationCode(db, userId, REDIRECT);
		expect(code).toMatch(/^[a-z2-7]{32}$/);
		const rows = await db.select().from(authorizationCodes).all();
		expect(rows).toHaveLength(1);
		expect(rows[0]!.id).not.toBe(code);
		expect(rows[0]!.id).toMatch(/^[0-9a-f]{64}$/);
		expect(rows[0]!.userId).toBe(userId);
		expect(rows[0]!.redirectUri).toBe(REDIRECT);
	});

	it('creates no session until the code is exchanged', async () => {
		const db = makeDb(env.DB);
		const userId = await seedUser();
		await createAuthorizationCode(db, userId, REDIRECT);
		expect(await db.select().from(sessions).all()).toHaveLength(0);
	});

	it('exchanges a code for a valid session exactly once', async () => {
		const db = makeDb(env.DB);
		const userId = await seedUser();
		const { code } = await createAuthorizationCode(db, userId, REDIRECT);

		const first = await exchangeAuthorizationCode(db, code, REDIRECT);
		expect(first).not.toBeNull();
		expect((await validateSession(db, first!.token))?.userId).toBe(userId);

		expect(await exchangeAuthorizationCode(db, code, REDIRECT)).toBeNull();
		expect(await db.select().from(authorizationCodes).all()).toHaveLength(0);
	});

	it('rejects a mismatched redirect URI and consumes the code', async () => {
		const db = makeDb(env.DB);
		const userId = await seedUser();
		const { code } = await createAuthorizationCode(db, userId, REDIRECT);

		expect(await exchangeAuthorizationCode(db, code, 'http://localhost:5173/')).toBeNull();
		expect(await db.select().from(authorizationCodes).all()).toHaveLength(0);
		expect(await exchangeAuthorizationCode(db, code, REDIRECT)).toBeNull();
		expect(await db.select().from(sessions).all()).toHaveLength(0);
	});

	it('rejects an unknown code', async () => {
		const db = makeDb(env.DB);
		expect(await exchangeAuthorizationCode(db, 'nope', REDIRECT)).toBeNull();
	});

	it('rejects a code for a user disabled since it was issued, and creates no session', async () => {
		const db = makeDb(env.DB);
		const userId = await seedUser();
		const { code } = await createAuthorizationCode(db, userId, REDIRECT);
		await setUserActive(db, userId, false, { reason: 'test' });

		expect(await exchangeAuthorizationCode(db, code, REDIRECT)).toBeNull();
		expect(await db.select().from(sessions).all()).toHaveLength(0);
	});

	it('rejects an expired code and prunes it', async () => {
		const db = makeDb(env.DB);
		const userId = await seedUser();
		const { code } = await createAuthorizationCode(db, userId, REDIRECT);

		vi.useFakeTimers({ toFake: ['Date'] });
		vi.setSystemTime(Date.now() + AUTHORIZATION_CODE_LIFETIME_MS + 1000);

		expect(await exchangeAuthorizationCode(db, code, REDIRECT)).toBeNull();
		expect(await db.select().from(authorizationCodes).all()).toHaveLength(0);
		expect(await db.select().from(sessions).all()).toHaveLength(0);
	});
});
