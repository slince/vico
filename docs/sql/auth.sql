-- ============================================================
-- Vico 认证授权表 (better-auth)
-- ============================================================

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
CREATE UNIQUE INDEX `user_email_unique` ON `user` (`email`);
CREATE UNIQUE INDEX `user_username_unique` ON `user` (`username`);

CREATE TABLE `session` (
    `id` text PRIMARY KEY NOT NULL,
    `userId` text NOT NULL,
    `token` text NOT NULL,
    `expiresAt` integer NOT NULL,
    `ipAddress` text,
    `userAgent` text,
    `activeOrganizationId` text,
    `createdAt` integer NOT NULL,
    `updatedAt` integer NOT NULL,
    FOREIGN KEY (`userId`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
CREATE UNIQUE INDEX `session_token_unique` ON `session` (`token`);

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

CREATE TABLE `verification` (
    `id` text PRIMARY KEY NOT NULL,
    `identifier` text NOT NULL,
    `value` text NOT NULL,
    `expiresAt` integer NOT NULL,
    `createdAt` integer NOT NULL,
    `updatedAt` integer NOT NULL
);

CREATE TABLE `organization` (
    `id` text PRIMARY KEY NOT NULL,
    `name` text NOT NULL,
    `slug` text,
    `logo` text,
    `metadata` text,
    `createdAt` integer NOT NULL
);
CREATE UNIQUE INDEX `organization_slug_unique` ON `organization` (`slug`);

CREATE TABLE `member` (
    `id` text PRIMARY KEY NOT NULL,
    `organizationId` text NOT NULL,
    `userId` text NOT NULL,
    `role` text DEFAULT 'member' NOT NULL,
    `createdAt` integer NOT NULL,
    FOREIGN KEY (`organizationId`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade,
    FOREIGN KEY (`userId`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);

CREATE TABLE `invitation` (
    `id` text PRIMARY KEY NOT NULL,
    `organizationId` text NOT NULL,
    `email` text NOT NULL,
    `role` text,
    `status` text DEFAULT 'pending' NOT NULL,
    `expiresAt` integer NOT NULL,
    `inviterId` text NOT NULL,
    `createdAt` integer NOT NULL,
    FOREIGN KEY (`organizationId`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade,
    FOREIGN KEY (`inviterId`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
