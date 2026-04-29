CREATE TABLE `users` (
	`id` text PRIMARY KEY NOT NULL,
	`cid` text NOT NULL,
	`email` text NOT NULL,
	`first_name` text NOT NULL,
	`last_name` text NOT NULL,
	`preferred_name` text,
	`pronouns` text,
	`discord_id` text,
	`vatsim_data` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `users_cid_unique` ON `users` (`cid`);--> statement-breakpoint
CREATE INDEX `idx_users_cid` ON `users` (`cid`);