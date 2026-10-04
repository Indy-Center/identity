import { env, exports } from 'cloudflare:workers';
import { beforeEach, describe, expect, it } from 'vitest';
import { makeDb } from '../../src/db';
import { sessions, users, userRoles } from '../../src/schema';
import { upsertFromVatsim } from '../../src/users/domain';
import { createSession } from '../../src/sessions/domain';
import { makeVatsimProfile } from '../helpers/fixtures';

const LOGOUT =
	'https://id.flyindycenter.com/logout?return_url=' +
	encodeURIComponent('https://charts.flyindycenter.com/');

beforeEach(async () => {
	const db = makeDb(env.DB);
	await db.delete(userRoles);
	await db.delete(sessions);
	await db.delete(users);
});

describe('GET /logout', () => {
	it("ends every session of the user named by identity's cookie and redirects", async () => {
		const db = makeDb(env.DB);
		const { cid } = await upsertFromVatsim(db, makeVatsimProfile({ cid: '1' }));
		const { cid: otherId } = await upsertFromVatsim(db, makeVatsimProfile({ cid: '2' }));
		const identitySession = await createSession(db, cid);
		await createSession(db, cid); // an app's session for the same user
		await createSession(db, otherId); // someone else's, must survive

		const res = await exports.default.fetch(LOGOUT, {
			redirect: 'manual',
			headers: { Cookie: `__Host-identity_session=${identitySession.token}` }
		});

		expect(res.status).toBe(302);
		expect(res.headers.get('Location')).toBe('https://charts.flyindycenter.com/');

		const setCookies = res.headers.getSetCookie();
		const cleared = setCookies.find((c) => c.startsWith('__Host-identity_session='));
		expect(cleared).toMatch(/^__Host-identity_session=;/);
		expect(cleared).toContain('Max-Age=0');
		const legacy = setCookies.find((c) => c.startsWith('fic_session='));
		expect(legacy).toContain('Domain=.flyindycenter.com');
		expect(legacy).toContain('Max-Age=0');

		const remaining = await db.select().from(sessions).all();
		expect(remaining).toHaveLength(1);
		expect(remaining[0]!.cid).toBe(otherId);
	});

	it('still clears cookies and redirects when no cookie is present', async () => {
		const res = await exports.default.fetch(LOGOUT, { redirect: 'manual' });
		expect(res.status).toBe(302);
		expect(res.headers.get('Location')).toBe('https://charts.flyindycenter.com/');
	});

	it('still redirects for an unknown identity cookie', async () => {
		const res = await exports.default.fetch(LOGOUT, {
			redirect: 'manual',
			headers: { Cookie: '__Host-identity_session=unknown' }
		});
		expect(res.status).toBe(302);
	});

	it('accepts a loopback return_url', async () => {
		const res = await exports.default.fetch(
			'https://id.flyindycenter.com/logout?return_url=' +
				encodeURIComponent('http://localhost:5173/'),
			{ redirect: 'manual' }
		);
		expect(res.status).toBe(302);
		expect(res.headers.get('Location')).toBe('http://localhost:5173/');
	});

	it('400s for an off-domain or missing return_url', async () => {
		const offDomain = await exports.default.fetch(
			'https://id.flyindycenter.com/logout?return_url=https://evil.com/',
			{ redirect: 'manual' }
		);
		expect(offDomain.status).toBe(400);
		const missing = await exports.default.fetch('https://id.flyindycenter.com/logout', {
			redirect: 'manual'
		});
		expect(missing.status).toBe(400);
		const body = (await missing.json()) as { error: { code: string } };
		expect(body.error.code).toBe('invalid_return_url');
	});
});
