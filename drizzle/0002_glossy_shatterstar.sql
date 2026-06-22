CREATE TABLE `User` (
	`id` text PRIMARY KEY NOT NULL,
	`email` text NOT NULL,
	`passwordHash` text NOT NULL,
	`createdAt` integer NOT NULL,
	`updatedAt` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `User_email_key` ON `User` (`email`);--> statement-breakpoint
CREATE TABLE `AuthSession` (
	`id` text PRIMARY KEY NOT NULL,
	`userId` text NOT NULL,
	`tokenHash` text NOT NULL,
	`expiresAt` integer NOT NULL,
	`createdAt` integer NOT NULL,
	`updatedAt` integer NOT NULL,
	FOREIGN KEY (`userId`) REFERENCES `User`(`id`) ON UPDATE cascade ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `AuthSession_tokenHash_key` ON `AuthSession` (`tokenHash`);--> statement-breakpoint
CREATE INDEX `AuthSession_userId_expiresAt_idx` ON `AuthSession` (`userId`,`expiresAt`);--> statement-breakpoint
DROP INDEX `Vocabulary_word_key`;--> statement-breakpoint
ALTER TABLE `Vocabulary` ADD `userId` text REFERENCES User(id);--> statement-breakpoint
CREATE UNIQUE INDEX `Vocabulary_userId_word_key` ON `Vocabulary` (`userId`,`word`);--> statement-breakpoint
CREATE INDEX `Vocabulary_userId_createdAt_idx` ON `Vocabulary` (`userId`,`createdAt`);--> statement-breakpoint
ALTER TABLE `ReadingHistory` ADD `userId` text REFERENCES User(id);--> statement-breakpoint
CREATE INDEX `ReadingHistory_userId_createdAt_idx` ON `ReadingHistory` (`userId`,`createdAt`);
