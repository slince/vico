ALTER TABLE `agents` ADD `builtin_tools` text NOT NULL DEFAULT '{}';
--> statement-breakpoint
CREATE TABLE `exec_approvals` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`agent_id` text NOT NULL REFERENCES `agents`(`id`) ON UPDATE no action ON DELETE no action,
	`command` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`created_at` integer NOT NULL,
	`resolved_at` integer,
	FOREIGN KEY (`tenant_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `idx_ea_tenant_status` ON `exec_approvals` (`tenant_id`, `status`);
