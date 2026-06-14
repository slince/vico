CREATE TABLE `eval_datasets` (
	`id` text PRIMARY KEY NOT NULL,
	`tenant_id` text NOT NULL,
	`name` text NOT NULL,
	`agent_id` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`tenant_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `eval_test_cases` (
	`id` text PRIMARY KEY NOT NULL,
	`dataset_id` text NOT NULL,
	`input` text NOT NULL,
	`expected_tools` text,
	`reference_answer` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`dataset_id`) REFERENCES `eval_datasets`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `eval_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`dataset_id` text NOT NULL,
	`status` text NOT NULL,
	`total_cases` integer DEFAULT 0 NOT NULL,
	`completed_cases` integer DEFAULT 0 NOT NULL,
	`overall_score` real,
	`scorer_scores` text,
	`created_at` integer NOT NULL,
	`completed_at` integer,
	FOREIGN KEY (`dataset_id`) REFERENCES `eval_datasets`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `eval_case_results` (
	`id` text PRIMARY KEY NOT NULL,
	`run_id` text NOT NULL,
	`case_id` text NOT NULL,
	`input` text NOT NULL,
	`actual_output` text NOT NULL,
	`scores` text NOT NULL,
	`details` text,
	`tool_calls` text,
	`latency` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`run_id`) REFERENCES `eval_runs`(`id`) ON UPDATE no action ON DELETE cascade
);
