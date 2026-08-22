CREATE TABLE `agent_teams` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`routing_strategy` text DEFAULT 'supervisor' NOT NULL,
	`supervisor_agent_id` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`supervisor_agent_id`) REFERENCES `agents`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `agent_team_members` (
	`id` text PRIMARY KEY NOT NULL,
	`team_id` text NOT NULL,
	`agent_id` text NOT NULL,
	`role` text DEFAULT 'member' NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`team_id`) REFERENCES `agent_teams`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`agent_id`) REFERENCES `agents`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `agent_team_members_team_id_agent_id_unique` ON `agent_team_members` (`team_id`,`agent_id`);
