CREATE TABLE `account` (
	`id` text PRIMARY KEY NOT NULL,
	`userId` text NOT NULL,
	`accountId` text NOT NULL,
	`providerId` text NOT NULL,
	`accessToken` text,
	`refreshToken` text,
	`idToken` text,
	`accessTokenExpiresAt` integer,
	`refreshTokenExpiresAt` integer,
	`scope` text,
	`password` text,
	`createdAt` integer NOT NULL,
	`updatedAt` integer NOT NULL,
	FOREIGN KEY (`userId`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `agent_knowledge_bases` (
	`agent_id` text NOT NULL,
	`kb_id` text NOT NULL,
	`mode` text DEFAULT 'auto' NOT NULL,
	PRIMARY KEY(`agent_id`, `kb_id`),
	FOREIGN KEY (`agent_id`) REFERENCES `agents`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`kb_id`) REFERENCES `knowledge_bases`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `agent_skills` (
	`agent_id` text NOT NULL,
	`skill_name` text NOT NULL,
	`config` text DEFAULT '{}' NOT NULL,
	PRIMARY KEY(`agent_id`, `skill_name`),
	FOREIGN KEY (`agent_id`) REFERENCES `agents`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `agents` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`system_prompt` text DEFAULT '' NOT NULL,
	`model_id` text NOT NULL,
	`temperature` real DEFAULT 0.7 NOT NULL,
	`max_tokens` integer DEFAULT 4096 NOT NULL,
	`rag_mode` text DEFAULT 'auto' NOT NULL,
	`enabled` integer DEFAULT 1 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `chunks` (
	`id` text PRIMARY KEY NOT NULL,
	`kb_id` text NOT NULL,
	`content` text NOT NULL,
	`embedding` blob NOT NULL,
	`metadata` text DEFAULT '{}' NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`kb_id`) REFERENCES `knowledge_bases`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `conversations` (
	`id` text PRIMARY KEY NOT NULL,
	`agent_id` text NOT NULL,
	`user_id` text NOT NULL,
	`title` text DEFAULT '' NOT NULL,
	`model_name` text NOT NULL,
	`message_count` integer DEFAULT 0 NOT NULL,
	`total_tokens` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`agent_id`) REFERENCES `agents`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `installed_skills` (
	`id` text PRIMARY KEY NOT NULL,
	`skill_name` text NOT NULL,
	`display_name` text NOT NULL,
	`version` text NOT NULL,
	`config` text DEFAULT '{}' NOT NULL,
	`enabled` integer DEFAULT 1 NOT NULL,
	`installed_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `installed_skills_skill_name_unique` ON `installed_skills` (`skill_name`);
--> statement-breakpoint
CREATE TABLE `knowledge_bases` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`source` text DEFAULT 'upload' NOT NULL,
	`skill_name` text,
	`chunk_count` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `memory_entries` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`type` text NOT NULL,
	`content` text NOT NULL,
	`embedding` blob,
	`importance` real DEFAULT 0.5 NOT NULL,
	`created_at` integer NOT NULL,
	`expires_at` integer,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `messages` (
	`id` text PRIMARY KEY NOT NULL,
	`conversation_id` text NOT NULL,
	`role` text NOT NULL,
	`content` text NOT NULL,
	`tool_calls` text,
	`token_usage` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`conversation_id`) REFERENCES `conversations`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `model_configs` (
	`id` text PRIMARY KEY NOT NULL,
	`provider` text NOT NULL,
	`model_name` text NOT NULL,
	`api_key_encrypted` text NOT NULL,
	`base_url` text,
	`is_default` integer DEFAULT 0 NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `session` (
	`id` text PRIMARY KEY NOT NULL,
	`userId` text NOT NULL,
	`token` text NOT NULL,
	`expiresAt` integer NOT NULL,
	`ipAddress` text,
	`userAgent` text,
	`createdAt` integer NOT NULL,
	`updatedAt` integer NOT NULL,
	FOREIGN KEY (`userId`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `session_token_unique` ON `session` (`token`);--> statement-breakpoint
CREATE TABLE `token_usage_logs` (
	`id` text PRIMARY KEY NOT NULL,
	`agent_id` text NOT NULL,
	`model_name` text NOT NULL,
	`prompt_tokens` integer NOT NULL,
	`completion_tokens` integer NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `tool_call_logs` (
	`id` text PRIMARY KEY NOT NULL,
	`agent_id` text NOT NULL,
	`conversation_id` text NOT NULL,
	`message_id` text NOT NULL,
	`tool_name` text NOT NULL,
	`args` text NOT NULL,
	`result` text,
	`status` text NOT NULL,
	`duration_ms` integer NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `user` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`email` text NOT NULL,
	`emailVerified` integer DEFAULT false NOT NULL,
	`image` text,
	`createdAt` integer NOT NULL,
	`updatedAt` integer NOT NULL,
	`username` text,
	`displayUsername` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `user_email_unique` ON `user` (`email`);--> statement-breakpoint
CREATE UNIQUE INDEX `user_username_unique` ON `user` (`username`);--> statement-breakpoint
CREATE TABLE `verification` (
	`id` text PRIMARY KEY NOT NULL,
	`identifier` text NOT NULL,
	`value` text NOT NULL,
	`expiresAt` integer NOT NULL,
	`createdAt` integer NOT NULL,
	`updatedAt` integer NOT NULL
);
