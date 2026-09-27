// src/users/routes.ts
// /api/users and /api/me. Every route runs behind `principal`; see
// src/api/principal.ts for who may call what. No CORS: server-to-server only.
import { Hono } from 'hono';
import { describeRoute, resolver } from 'hono-openapi';
import { z } from 'zod';
import { makeDb } from '../db';
import { IdentityError } from '../errors';
import { validate } from '../validation';
import { errors } from '../openapi';
import { principal, requireScope, roleSource, type ApiEnv } from '../api/principal';
import { getUser, listUsers, setUserActive, updateProfile, type ProfilePatch } from './domain';
import {
	RoleGrantSchema,
	RoleNameSchema,
	RoleRemovePatternSchema,
	listRoleGrants,
	listRoles,
	listRolesOfHolders,
	patchRoles
} from './roles';
import { ClaimsSchema, toClaims } from './claims';
import type { DB } from '../db';
import type { User } from '../schema';

export const apiRoutes = new Hono<ApiEnv>();
apiRoutes.use('*', principal);

const CidParam = z.object({ cid: z.string().regex(/^\d{1,10}$/) });

const SelfFields = {
	preferred_name: z.string().trim().min(1).max(64).nullable().optional(),
	pronouns: z.string().trim().min(1).max(32).nullable().optional()
};
const SelfPatchSchema = z.strictObject(SelfFields);
const UserPatchSchema = z
	.strictObject({
		...SelfFields,
		operating_initials: z
			.string()
			.regex(/^[A-Z]{2}$/)
			.nullable()
			.optional(),
		discord_id: z
			.string()
			.regex(/^\d{17,20}$/)
			.nullable()
			.optional(),
		active: z.boolean().optional(),
		disabled_reason: z.string().trim().max(500).optional()
	})
	.refine((b) => b.disabled_reason === undefined || b.active === false, {
		message: 'disabled_reason requires active: false',
		path: ['disabled_reason']
	});
const ListQuery = z
	.object({ role: RoleNameSchema.optional(), discord_id: z.string().min(1).optional() })
	.refine((q) => (q.role === undefined) !== (q.discord_id === undefined), {
		message: 'exactly one of role or discord_id is required'
	});
const RolePatchSchema = z.strictObject({
	add: z.array(RoleNameSchema).max(100).optional(),
	remove: z.array(RoleRemovePatternSchema).max(100).optional()
});

const tags = ['Users'];
const bearer = [{ bearerAuth: [] }];

/** A describeRoute() `responses` 200 entry for a zod schema. */
function ok(description: string, schema: z.ZodTypeAny) {
	return { description, content: { 'application/json': { schema: resolver(schema) } } };
}

async function claimsFor(db: DB, user: User) {
	return toClaims(user, await listRoles(db, user.cid));
}

function toProfilePatch(body: z.infer<typeof UserPatchSchema>): ProfilePatch {
	return {
		preferredName: body.preferred_name,
		pronouns: body.pronouns,
		operatingInitials: body.operating_initials,
		discordId: body.discord_id
	};
}

apiRoutes.get(
	'/users',
	describeRoute({
		tags,
		security: bearer,
		summary: 'List users by role or Discord ID (users:read)',
		responses: {
			200: ok('Claims for each matching user', z.array(ClaimsSchema)),
			...errors(401, 403)
		}
	}),
	requireScope('users:read'),
	validate('query', ListQuery),
	async (c) => {
		const q = c.req.valid('query');
		const db = makeDb(c.env.DB);
		if (q.discord_id !== undefined) {
			// discord_id is unique: at most one user.
			const found = await listUsers(db, { discordId: q.discord_id });
			return c.json(await Promise.all(found.map((u) => claimsFor(db, u))));
		}
		const found = await listUsers(db, { role: q.role! });
		const roles = await listRolesOfHolders(db, q.role!);
		return c.json(found.map((u) => toClaims(u, roles.get(u.cid) ?? [])));
	}
);

apiRoutes.get(
	'/users/:cid',
	describeRoute({
		tags,
		security: bearer,
		summary: 'Get a user by CID (users:read)',
		responses: { 200: ok('The user', ClaimsSchema), ...errors(401, 403, 404) }
	}),
	requireScope('users:read'),
	validate('param', CidParam),
	async (c) => {
		const db = makeDb(c.env.DB);
		const user = await getUser(db, c.req.valid('param').cid);
		if (!user) {
			throw new IdentityError('not_found', 404, 'user not found');
		}
		return c.json(await claimsFor(db, user));
	}
);

apiRoutes.patch(
	'/users/:cid',
	describeRoute({
		tags,
		security: bearer,
		summary: 'Update identity-owned fields (users:write)',
		responses: { 200: ok('The updated user', ClaimsSchema), ...errors(401, 403, 404, 409) }
	}),
	requireScope('users:write'),
	validate('param', CidParam),
	validate('json', UserPatchSchema),
	async (c) => {
		const db = makeDb(c.env.DB);
		const { cid } = c.req.valid('param');
		const body = c.req.valid('json');
		let user = await updateProfile(db, cid, toProfilePatch(body));
		if (body.active !== undefined) {
			user = await setUserActive(db, cid, body.active, { reason: body.disabled_reason });
		}
		return c.json(await claimsFor(db, user));
	}
);

apiRoutes.get(
	'/users/:cid/roles',
	describeRoute({
		tags,
		security: bearer,
		summary: 'List role grants with their sources (users:read)',
		responses: {
			200: ok('Role grants with sources', z.array(RoleGrantSchema)),
			...errors(401, 403)
		}
	}),
	requireScope('users:read'),
	validate('param', CidParam),
	async (c) => c.json(await listRoleGrants(makeDb(c.env.DB), c.req.valid('param').cid))
);

apiRoutes.patch(
	'/users/:cid/roles',
	describeRoute({
		tags,
		security: bearer,
		summary: "Add/remove the caller's own role grants (users:write)",
		description:
			'remove runs before add. remove accepts `*` and `app:*` (caller rows only). global:* cannot be added or removed.',
		responses: {
			200: ok('The full set of roles after the patch', z.object({ roles: z.array(z.string()) })),
			...errors(401, 403)
		}
	}),
	requireScope('users:write'),
	validate('param', CidParam),
	validate('json', RolePatchSchema),
	async (c) => {
		const roles = await patchRoles(
			makeDb(c.env.DB),
			c.req.valid('param').cid,
			roleSource(c.var.principal),
			c.req.valid('json')
		);
		return c.json({ roles });
	}
);

apiRoutes.patch(
	'/me',
	describeRoute({
		tags,
		security: bearer,
		summary: 'Edit your own preferred name and pronouns (user token)',
		responses: {
			200: ok('Your claims, plus email', ClaimsSchema.extend({ email: z.string() })),
			...errors(401, 403)
		}
	}),
	validate('json', SelfPatchSchema),
	async (c) => {
		const p = c.var.principal;
		if (p.kind !== 'user') {
			throw new IdentityError('insufficient_scope', 403, '/api/me requires a user token');
		}
		const db = makeDb(c.env.DB);
		const body = c.req.valid('json');
		const user = await updateProfile(db, p.cid, {
			preferredName: body.preferred_name,
			pronouns: body.pronouns
		});
		// The one /api response with email: the caller's own record.
		return c.json({ ...(await claimsFor(db, user)), email: user.email });
	}
);
