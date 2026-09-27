// src/schema.ts
import { sqliteTable, text, integer, index, primaryKey } from 'drizzle-orm/sqlite-core';
import type { VatsimProfile } from './oauth/vatsim';

export type Scope = 'users:read' | 'users:write';

// One row per VATSIM member. Each column has exactly one writer:
// VATSIM-owned columns are overwritten by upsertFromVatsim at every login;
// identity-owned columns are written only through the /api PATCH routes.
export const users = sqliteTable(
	'users',
	{
		cid: text('cid').primaryKey(),
		// owned by VATSIM
		firstName: text('first_name'),
		lastName: text('last_name'),
		email: text('email').notNull(),
		rating: text('rating'),
		pilotRating: text('pilot_rating'),
		division: text('division'),
		region: text('region'),
		subdivision: text('subdivision'),
		vatsimProfile: text('vatsim_profile', { mode: 'json' }).$type<VatsimProfile>().notNull(),
		vatsimSyncedAt: integer('vatsim_synced_at').notNull(),
		// owned by identity
		preferredName: text('preferred_name'),
		pronouns: text('pronouns'),
		operatingInitials: text('operating_initials').unique(),
		discordId: text('discord_id').unique(),
		active: integer('active', { mode: 'boolean' }).notNull().default(true),
		disabledReason: text('disabled_reason'),
		disabledAt: integer('disabled_at'),
		createdAt: integer('created_at').notNull(),
		updatedAt: integer('updated_at').notNull()
	},
	(t) => [index('idx_users_email').on(t.email)]
);

export type User = typeof users.$inferSelect;

export const sessions = sqliteTable(
	'sessions',
	{
		id: text('id').primaryKey(),
		cid: text('cid')
			.notNull()
			.references(() => users.cid, { onDelete: 'cascade' }),
		expiresAt: integer('expires_at').notNull(),
		createdAt: integer('created_at').notNull(),
		lastSeenAt: integer('last_seen_at').notNull()
	},
	(t) => [index('idx_sessions_cid').on(t.cid), index('idx_sessions_expires').on(t.expiresAt)]
);

export type Session = typeof sessions.$inferSelect;

// Single-use OAuth authorization codes (RFC 6749 §4.1), 60-second TTL.
// `id` is sha256(code). Bound to the redirect_uri and client_id it was issued for.
export const authorizationCodes = sqliteTable(
	'authorization_codes',
	{
		id: text('id').primaryKey(),
		cid: text('cid')
			.notNull()
			.references(() => users.cid, { onDelete: 'cascade' }),
		clientId: text('client_id').notNull(),
		redirectUri: text('redirect_uri').notNull(),
		expiresAt: integer('expires_at').notNull(),
		createdAt: integer('created_at').notNull()
	},
	(t) => [index('idx_authorization_codes_expires').on(t.expiresAt)]
);

// No FK to users: roles may be granted before a member first logs in.
// `source` is who wrote the row (client id, `user:<cid>`, or `cli`).
export const userRoles = sqliteTable(
	'user_roles',
	{
		cid: text('cid').notNull(),
		role: text('role').notNull(),
		source: text('source').notNull(),
		grantedAt: integer('granted_at').notNull()
	},
	(t) => [
		primaryKey({ columns: [t.cid, t.role, t.source] }),
		index('idx_user_roles_role').on(t.role)
	]
);

// Registered OAuth clients and services. `secretHash` is sha256(secret).
// `redirectUris` is set for authorization-code clients, null for pure services.
export const clients = sqliteTable('clients', {
	id: text('id').primaryKey(),
	secretHash: text('secret_hash').notNull().unique(),
	redirectUris: text('redirect_uris', { mode: 'json' }).$type<string[]>(),
	scopes: text('scopes', { mode: 'json' }).$type<Scope[]>().notNull(),
	createdAt: integer('created_at').notNull()
});

export type Client = typeof clients.$inferSelect;

// Client-credentials access tokens (RFC 6749 §4.4). `id` is sha256(token).
export const clientTokens = sqliteTable(
	'client_tokens',
	{
		id: text('id').primaryKey(),
		clientId: text('client_id')
			.notNull()
			.references(() => clients.id, { onDelete: 'cascade' }),
		scopes: text('scopes', { mode: 'json' }).$type<Scope[]>().notNull(),
		expiresAt: integer('expires_at').notNull(),
		createdAt: integer('created_at').notNull()
	},
	(t) => [index('idx_client_tokens_expires').on(t.expiresAt)]
);
