import { sqliteTable, text, integer, index, primaryKey } from 'drizzle-orm/sqlite-core';
import type { Attributes } from './client/attributes';
import type { VatsimProfile } from './client/vatsim';

export const users = sqliteTable(
	'users',
	{
		id: text('id').primaryKey(),
		cid: text('cid').notNull().unique(),
		email: text('email').notNull(),
		vatsimData: text('vatsim_data', { mode: 'json' }).$type<VatsimProfile>().notNull(),
		attributes: text('attributes', { mode: 'json' }).$type<Attributes>().notNull().default({}),
		isActive: integer('is_active', { mode: 'boolean' }).notNull().default(true),
		createdAt: integer('created_at').notNull(),
		updatedAt: integer('updated_at').notNull()
	},
	(t) => [index('idx_users_email').on(t.email)]
);

export const sessions = sqliteTable(
	'sessions',
	{
		id: text('id').primaryKey(),
		userId: text('user_id')
			.notNull()
			.references(() => users.id, { onDelete: 'cascade' }),
		expiresAt: integer('expires_at').notNull(),
		createdAt: integer('created_at').notNull(),
		lastSeenAt: integer('last_seen_at').notNull()
	},
	(t) => [index('idx_sessions_user').on(t.userId), index('idx_sessions_expires').on(t.expiresAt)]
);

export type Session = typeof sessions.$inferSelect;

export const userRoles = sqliteTable(
	'user_roles',
	{
		userId: text('user_id')
			.notNull()
			.references(() => users.id, { onDelete: 'cascade' }),
		role: text('role').notNull(),
		grantedAt: integer('granted_at').notNull(),
		grantedBy: text('granted_by')
	},
	(t) => [primaryKey({ columns: [t.userId, t.role] })]
);
