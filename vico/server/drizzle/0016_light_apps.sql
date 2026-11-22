CREATE TABLE `light_apps` (
	`id` text PRIMARY KEY NOT NULL,
	`installed` integer DEFAULT 1 NOT NULL,
	`enabled` integer DEFAULT 1 NOT NULL,
	`installed_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
