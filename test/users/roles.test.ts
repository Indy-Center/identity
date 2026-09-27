// test/users/roles.test.ts
import { env } from 'cloudflare:workers';
import { beforeEach, describe, expect, it } from 'vitest';
import { makeDb } from '../../src/db';
import { userRoles } from '../../src/schema';
import {
	RoleNameSchema,
	RoleRemovePatternSchema,
	listRoleGrants,
	listRoles,
	patchRoles
} from '../../src/users/roles';

const db = () => makeDb(env.DB);

beforeEach(async () => {
	await db().delete(userRoles);
});

describe('role name schemas', () => {
	it('requires app:permission names', () => {
		expect(RoleNameSchema.safeParse('events:can_sign_up').success).toBe(true);
		expect(RoleNameSchema.safeParse('feedback:full').success).toBe(true);
		for (const bad of ['admin', 'Events:x', 'events:*', 'a:b c', ':x', 'x:']) {
			expect(RoleNameSchema.safeParse(bad).success).toBe(false);
		}
	});

	it('allows * and app:* only in remove patterns', () => {
		for (const ok of ['*', 'community:*', 'community:admin']) {
			expect(RoleRemovePatternSchema.safeParse(ok).success).toBe(true);
		}
		for (const bad of ['comm*', '*:admin', 'community:ad*']) {
			expect(RoleRemovePatternSchema.safeParse(bad).success).toBe(false);
		}
	});
});

describe('patchRoles', () => {
	it('adds under the caller source and returns the combined set', async () => {
		await patchRoles(db(), '1', 'discord-bot', { add: ['discord:mod'] });
		const roles = await patchRoles(db(), '1', 'community', {
			add: ['feedback:full', 'discord:mod']
		});
		expect(roles).toEqual(['discord:mod', 'feedback:full']);
		expect(await listRoleGrants(db(), '1')).toEqual([
			{ role: 'discord:mod', source: 'community' },
			{ role: 'discord:mod', source: 'discord-bot' },
			{ role: 'feedback:full', source: 'community' }
		]);
	});

	it('removes only the caller rows; a role stays while another source grants it', async () => {
		await patchRoles(db(), '1', 'community', { add: ['events:can_sign_up'] });
		await patchRoles(db(), '1', 'discord-bot', { add: ['events:can_sign_up'] });
		await patchRoles(db(), '1', 'community', { remove: ['events:can_sign_up'] });
		expect(await listRoles(db(), '1')).toEqual(['events:can_sign_up']);
		await patchRoles(db(), '1', 'discord-bot', { remove: ['*'] });
		expect(await listRoles(db(), '1')).toEqual([]);
	});

	it('applies remove before add, so remove * + add replaces the caller set', async () => {
		await patchRoles(db(), '1', 'community', { add: ['a:one', 'a:two'] });
		await patchRoles(db(), '1', 'other', { add: ['b:keep'] });
		await patchRoles(db(), '1', 'community', { remove: ['*'], add: ['a:three'] });
		expect(await listRoleGrants(db(), '1')).toEqual([
			{ role: 'a:three', source: 'community' },
			{ role: 'b:keep', source: 'other' }
		]);
	});

	it('matches namespace wildcards by prefix, not LIKE', async () => {
		await patchRoles(db(), '1', 'c', {
			add: ['feedbackx:full', 'feedback_x:one', 'community:admin']
		});
		await patchRoles(db(), '1', 'c', { remove: ['feedback_x:*'] });
		expect(await listRoles(db(), '1')).toEqual(['community:admin', 'feedbackx:full']);
	});

	it('is idempotent', async () => {
		await patchRoles(db(), '1', 'c', { add: ['a:b'] });
		await patchRoles(db(), '1', 'c', { add: ['a:b'], remove: ['z:z'] });
		expect(await listRoleGrants(db(), '1')).toEqual([{ role: 'a:b', source: 'c' }]);
	});

	it('refuses to add global roles and never reaches cli rows', async () => {
		await db()
			.insert(userRoles)
			.values({ cid: '1', role: 'global:admin', source: 'cli', grantedAt: 1 });
		await expect(patchRoles(db(), '1', 'c', { add: ['global:admin'] })).rejects.toMatchObject({
			code: 'insufficient_scope',
			status: 403
		});
		await patchRoles(db(), '1', 'c', { remove: ['*', 'global:*', 'global:admin'] });
		expect(await listRoles(db(), '1')).toEqual(['global:admin']);
	});

	it('works for a cid identity has never seen', async () => {
		expect(await patchRoles(db(), 'never-logged-in', 'c', { add: ['a:b'] })).toEqual(['a:b']);
	});
});
