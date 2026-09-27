CREATE TABLE `authorization_codes` (
	`id` text PRIMARY KEY NOT NULL,
	`cid` text NOT NULL,
	`client_id` text NOT NULL,
	`redirect_uri` text NOT NULL,
	`expires_at` integer NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`cid`) REFERENCES `users`(`cid`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_authorization_codes_expires` ON `authorization_codes` (`expires_at`);--> statement-breakpoint
CREATE TABLE `client_tokens` (
	`id` text PRIMARY KEY NOT NULL,
	`client_id` text NOT NULL,
	`scopes` text NOT NULL,
	`expires_at` integer NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`client_id`) REFERENCES `clients`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_client_tokens_expires` ON `client_tokens` (`expires_at`);--> statement-breakpoint
CREATE TABLE `clients` (
	`id` text PRIMARY KEY NOT NULL,
	`secret_hash` text NOT NULL,
	`redirect_uris` text,
	`scopes` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `clients_secret_hash_unique` ON `clients` (`secret_hash`);--> statement-breakpoint
CREATE TABLE `sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`cid` text NOT NULL,
	`expires_at` integer NOT NULL,
	`created_at` integer NOT NULL,
	`last_seen_at` integer NOT NULL,
	FOREIGN KEY (`cid`) REFERENCES `users`(`cid`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_sessions_cid` ON `sessions` (`cid`);--> statement-breakpoint
CREATE INDEX `idx_sessions_expires` ON `sessions` (`expires_at`);--> statement-breakpoint
CREATE TABLE `user_roles` (
	`cid` text NOT NULL,
	`role` text NOT NULL,
	`source` text NOT NULL,
	`granted_at` integer NOT NULL,
	PRIMARY KEY(`cid`, `role`, `source`)
);
--> statement-breakpoint
CREATE INDEX `idx_user_roles_role` ON `user_roles` (`role`);--> statement-breakpoint
CREATE TABLE `users` (
	`cid` text PRIMARY KEY NOT NULL,
	`first_name` text,
	`last_name` text,
	`email` text NOT NULL,
	`rating` text,
	`pilot_rating` text,
	`division` text,
	`region` text,
	`subdivision` text,
	`vatsim_profile` text NOT NULL,
	`vatsim_synced_at` integer NOT NULL,
	`preferred_name` text,
	`pronouns` text,
	`operating_initials` text,
	`discord_id` text,
	`active` integer DEFAULT true NOT NULL,
	`disabled_reason` text,
	`disabled_at` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `users_operating_initials_unique` ON `users` (`operating_initials`);--> statement-breakpoint
CREATE UNIQUE INDEX `users_discord_id_unique` ON `users` (`discord_id`);--> statement-breakpoint
CREATE INDEX `idx_users_email` ON `users` (`email`);