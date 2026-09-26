ALTER TABLE `user` ADD COLUMN `role` text NOT NULL DEFAULT 'user';
--> statement-breakpoint
UPDATE `user` SET `role` = 'admin' WHERE `username` = 'admin';
