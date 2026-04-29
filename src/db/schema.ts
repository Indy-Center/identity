import { sqliteTable, text, integer, index } from 'drizzle-orm/sqlite-core';

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
