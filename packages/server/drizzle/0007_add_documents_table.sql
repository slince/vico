CREATE TABLE `documents` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`kb_id` text NOT NULL,
	`filename` text NOT NULL,
	`file_type` text NOT NULL,
	`file_size` integer DEFAULT 0 NOT NULL,
	`file_hash` text,
	`chunk_count` integer DEFAULT 0 NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`error_msg` text,
	`tags` text DEFAULT '[]' NOT NULL,
	`source` text DEFAULT 'upload' NOT NULL,
	`source_url` text,
	`metadata` text DEFAULT '{}' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`kb_id`) REFERENCES `knowledge_bases`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_documents_kb_id` ON `documents` (`kb_id`);
--> statement-breakpoint
CREATE INDEX `idx_documents_tenant` ON `documents` (`tenant_id`);
--> statement-breakpoint
CREATE UNIQUE INDEX `uq_documents_kb_file` ON `documents` (`kb_id`, `file_hash`);
