// test/auth/routes-logout.test.ts
import { env } from 'cloudflare:workers';
import { beforeEach, describe, expect, it } from 'vitest';
import { makeDb } from '../../src/db';
import { sessions, users, userRoles } from '../../src/schema';
import { upsertFromVatsim } from '../../src/users/domain';
import { createSession } from '../../src/sessions/domain';
import { makeVatsimProfile } from '../helpers/fixtures';

beforeEach(async () => {
	const db = makeDb(env.DB);
	await db.delete(userRoles);
	await db.delete(sessions);
	await db.delete(users);
});

describe('GET /logout', () => {
	it('clears the session cookie and redirects to the validated return_url', async () => {
		const db = makeDb(env.DB);
		const { id: userId } = await upsertFromVatsim(db, makeVatsimProfile({ cid: '1' }));
		const { token } = await createSession(db, userId);

		const req = new Request(
			'https://identity.flyindycenter.com/logout?return_url=https://charts.flyindycenter.com/',
			{
				headers: { cookie: `fic_session=${token}` },
				redirect: 'manual'
			}
		);
		const res = await env.IDENTITY.fetch(req);

		expect(res.status).toBe(302);
		expect(res.headers.get('location')).toBe('https://charts.flyindycenter.com/');
		const setCookie = res.headers.get('set-cookie') ?? '';
		expect(setCookie).toMatch(/^fic_session=;/);
		expect(setCookie.toLowerCase()).toContain('max-age=0');

		// Session row is gone.
		const rows = await db.select().from(sessions).all();
		expect(rows).toHaveLength(0);
	});

	it('rejects an off-domain return_url', async () => {
		const req = new Request(
			'https://identity.flyindycenter.com/logout?return_url=https://evil.com/',
			{
				method: 'GET'
			}
		);
		const res = await env.IDENTITY.fetch(req);
		expect(res.status).toBe(400);
	});

	it('is a no-op when no cookie is present, still redirects', async () => {
		const req = new Request(
			'https://identity.flyindycenter.com/logout?return_url=https://charts.flyindycenter.com/',
			{ redirect: 'manual' }
		);
		const res = await env.IDENTITY.fetch(req);
		expect(res.status).toBe(302);
		expect(res.headers.get('location')).toBe('https://charts.flyindycenter.com/');
	});
});
