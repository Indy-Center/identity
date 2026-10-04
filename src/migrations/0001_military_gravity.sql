ALTER TABLE `users` ADD `teamspeak_uid` text;--> statement-breakpoint
CREATE UNIQUE INDEX `users_teamspeak_uid_unique` ON `users` (`teamspeak_uid`);