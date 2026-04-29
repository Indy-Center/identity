import { sqliteTable, text, integer, index, primaryKey } from 'drizzle-orm/sqlite-core';

export const users = sqliteTable(
	'users',
	{
		id: text('id').primaryKey(),
		cid: text('cid').notNull().unique(),
		email: text('email').notNull(),
		firstName: text('first_name').notNull(),
		lastName: text('last_name').notNull(),
		preferredName: text('preferred_name'),
		pronouns: text('pronouns'),
		discordId: text('discord_id'),
		vatsimData: text('vatsim_data').notNull(),
		createdAt: integer('created_at').notNull(),
		updatedAt: integer('updated_at').notNull()
	},
	(t) => ({
		cidIdx: index('idx_users_cid').on(t.cid)
	})
);

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;

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
	(t) => ({
		userIdx: index('idx_sessions_user').on(t.userId),
		expiresIdx: index('idx_sessions_expires').on(t.expiresAt)
	})
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
	(t) => ({
		pk: primaryKey({ columns: [t.userId, t.role] })
	})
);

export type UserRole = typeof userRoles.$inferSelect;
