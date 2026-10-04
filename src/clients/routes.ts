// /api/clients: register, rotate and delete clients (see requireAdmin);
// `npm run client` does the same straight against the database.
import { Hono } from 'hono';
import { describeRoute } from 'hono-openapi';
import { z } from 'zod';
import { makeDb } from '../db';
import { logEvent } from '../log';
import { validate } from '../validation';
import { errors, ok } from '../openapi';
import { requireAdmin, roleSource, type ApiEnv } from '../api/principal';
import { SCOPES } from '../schema';
import {
	createClient,
	deleteClient,
	listClients,
	rotateClientSecret,
	updateClient
} from './domain';
import { clientIdProblem, redirectUriProblem } from './registration';

export const clientRoutes = new Hono<ApiEnv>();

/** A zod string that fails with whatever problem `check` reports. */
function checked(check: (value: string) => string | null) {
	return z.string().superRefine((value, ctx) => {
		const problem = check(value);
		if (problem) {
			ctx.addIssue({ code: 'custom', message: problem });
		}
	});
}

const ClientId = checked(clientIdProblem).max(64);
const Scopes = z.array(z.enum(SCOPES));
const RedirectUris = z.array(checked(redirectUriProblem)).max(20);
const IdParam = z.object({ id: ClientId });
const CreateSchema = z
	.strictObject({
		client_id: ClientId,
		scopes: Scopes.default([]),
		redirect_uris: RedirectUris.default([])
	})
	.refine((b) => b.scopes.length > 0 || b.redirect_uris.length > 0, {
		message: 'a client needs at least one scope or redirect_uri, else it can do nothing'
	});
const UpdateSchema = z
	.strictObject({ scopes: Scopes.optional(), redirect_uris: RedirectUris.optional() })
	.refine((b) => b.scopes !== undefined || b.redirect_uris !== undefined, {
		message: 'scopes or redirect_uris is required'
	});

const ClientSchema = z.object({
	client_id: z.string(),
	scopes: Scopes,
	redirect_uris: z.array(z.string()),
	created_at: z.number()
});
const SecretSchema = z.object({ client_id: z.string(), client_secret: z.string() });

type ClientRow = Awaited<ReturnType<typeof listClients>>[number];

function toJson(row: ClientRow): z.infer<typeof ClientSchema> {
	return {
		client_id: row.id,
		scopes: row.scopes,
		redirect_uris: row.redirectUris ?? [],
		created_at: row.createdAt
	};
}

const tags = ['Clients'];
const bearer = [{ bearerAuth: [] }];

clientRoutes.get(
	'/clients',
	describeRoute({
		tags,
		security: bearer,
		summary: 'List registered clients (global:admin user, clients:manage)',
		responses: {
			200: ok('Every client, without secrets', z.array(ClientSchema)),
			...errors(401, 403)
		}
	}),
	requireAdmin,
	async (c) => c.json((await listClients(makeDb(c.env.DB))).map(toJson))
);

clientRoutes.post(
	'/clients',
	describeRoute({
		tags,
		security: bearer,
		summary: 'Register a client (global:admin user, clients:manage)',
		description:
			'scopes are what a service may do on /api with the client-credentials grant; redirect_uris (matched exactly) let it log users in. The secret is returned once and stored only as a hash.',
		responses: { 201: ok('The new client and its secret', SecretSchema), ...errors(401, 403, 409) }
	}),
	requireAdmin,
	validate('json', CreateSchema),
	async (c) => {
		const body = c.req.valid('json');
		const secret = await createClient(makeDb(c.env.DB), {
			id: body.client_id,
			scopes: body.scopes,
			redirectUris: body.redirect_uris
		});
		logEvent('client_created', { client_id: body.client_id, by: roleSource(c.var.principal) });
		return c.json({ client_id: body.client_id, client_secret: secret }, 201);
	}
);

clientRoutes.patch(
	'/clients/:id',
	describeRoute({
		tags,
		security: bearer,
		summary: "Replace a client's scopes or redirect URIs (global:admin user, clients:manage)",
		description:
			'Each list given replaces the stored one; the secret is kept. Changing scopes drops the tokens issued under the old ones.',
		responses: { 200: ok('The updated client', ClientSchema), ...errors(401, 403, 404) }
	}),
	requireAdmin,
	validate('param', IdParam),
	validate('json', UpdateSchema),
	async (c) => {
		const body = c.req.valid('json');
		const row = await updateClient(makeDb(c.env.DB), c.req.valid('param').id, {
			scopes: body.scopes,
			redirectUris: body.redirect_uris
		});
		logEvent('client_updated', { client_id: row.id, by: roleSource(c.var.principal) });
		return c.json(toJson(row));
	}
);

clientRoutes.post(
	'/clients/:id/rotate',
	describeRoute({
		tags,
		security: bearer,
		summary: "Replace a client's secret (global:admin)",
		description: 'The old secret and every token issued under it stop working immediately.',
		responses: { 200: ok('The client and its new secret', SecretSchema), ...errors(401, 403, 404) }
	}),
	requireAdmin,
	validate('param', IdParam),
	async (c) => {
		const { id } = c.req.valid('param');
		const secret = await rotateClientSecret(makeDb(c.env.DB), id);
		logEvent('client_rotated', { client_id: id, by: roleSource(c.var.principal) });
		return c.json({ client_id: id, client_secret: secret });
	}
);

clientRoutes.delete(
	'/clients/:id',
	describeRoute({
		tags,
		security: bearer,
		summary: 'Delete a client and its tokens (global:admin user, clients:manage)',
		responses: { 204: { description: 'Deleted' }, ...errors(401, 403, 404) }
	}),
	requireAdmin,
	validate('param', IdParam),
	async (c) => {
		const { id } = c.req.valid('param');
		await deleteClient(makeDb(c.env.DB), id);
		logEvent('client_deleted', { client_id: id, by: roleSource(c.var.principal) });
		return c.body(null, 204);
	}
);
