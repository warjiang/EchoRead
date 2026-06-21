CREATE TABLE `ArticleAudio` (
	`id` text PRIMARY KEY NOT NULL,
	`articleId` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`sourceUrl` text,
	`sourceAudioUrl` text,
	`sourcePath` text,
	`durationMs` integer,
	`coverageRatio` real,
	`sentenceCount` integer DEFAULT 0 NOT NULL,
	`clippedCount` integer DEFAULT 0 NOT NULL,
	`lastError` text,
	`startedAt` integer,
	`finishedAt` integer,
	`createdAt` integer NOT NULL,
	`updatedAt` integer NOT NULL,
	FOREIGN KEY (`articleId`) REFERENCES `Article`(`id`) ON UPDATE cascade ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `ArticleAudio_articleId_key` ON `ArticleAudio` (`articleId`);--> statement-breakpoint
CREATE TABLE `ArticleAudioJob` (
	`id` text PRIMARY KEY NOT NULL,
	`articleId` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`maxAttempts` integer DEFAULT 3 NOT NULL,
	`timeoutSeconds` integer DEFAULT 300 NOT NULL,
	`runAfter` integer NOT NULL,
	`lockedAt` integer,
	`workerJobId` text,
	`lastError` text,
	`createdAt` integer NOT NULL,
	`updatedAt` integer NOT NULL,
	FOREIGN KEY (`articleId`) REFERENCES `Article`(`id`) ON UPDATE cascade ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `ArticleAudioJob_articleId_key` ON `ArticleAudioJob` (`articleId`);--> statement-breakpoint
CREATE INDEX `ArticleAudioJob_status_runAfter_idx` ON `ArticleAudioJob` (`status`,`runAfter`);--> statement-breakpoint
CREATE TABLE `Article` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`url` text NOT NULL,
	`content` text NOT NULL,
	`summary` text,
	`category` text,
	`difficulty` text,
	`publishedAt` integer NOT NULL,
	`createdAt` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `Article_url_key` ON `Article` (`url`);--> statement-breakpoint
CREATE TABLE `MaterialJob` (
	`id` text PRIMARY KEY NOT NULL,
	`articleId` text NOT NULL,
	`jobType` text DEFAULT 'full_training_pack' NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`maxAttempts` integer DEFAULT 3 NOT NULL,
	`runAfter` integer NOT NULL,
	`lockedAt` integer,
	`lastError` text,
	`createdAt` integer NOT NULL,
	`updatedAt` integer NOT NULL,
	FOREIGN KEY (`articleId`) REFERENCES `Article`(`id`) ON UPDATE cascade ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `MaterialJob_status_runAfter_idx` ON `MaterialJob` (`status`,`runAfter`);--> statement-breakpoint
CREATE UNIQUE INDEX `MaterialJob_articleId_jobType_key` ON `MaterialJob` (`articleId`,`jobType`);--> statement-breakpoint
CREATE TABLE `PipelineEvent` (
	`id` text PRIMARY KEY NOT NULL,
	`scope` text NOT NULL,
	`entityType` text NOT NULL,
	`entityId` text,
	`articleId` text,
	`jobId` text,
	`status` text NOT NULL,
	`message` text NOT NULL,
	`errorMessage` text,
	`metadataJson` text,
	`durationMs` integer,
	`createdAt` integer NOT NULL,
	FOREIGN KEY (`articleId`) REFERENCES `Article`(`id`) ON UPDATE cascade ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `PipelineEvent_scope_createdAt_idx` ON `PipelineEvent` (`scope`,`createdAt`);--> statement-breakpoint
CREATE INDEX `PipelineEvent_entityType_entityId_idx` ON `PipelineEvent` (`entityType`,`entityId`);--> statement-breakpoint
CREATE INDEX `PipelineEvent_articleId_createdAt_idx` ON `PipelineEvent` (`articleId`,`createdAt`);--> statement-breakpoint
CREATE INDEX `PipelineEvent_jobId_createdAt_idx` ON `PipelineEvent` (`jobId`,`createdAt`);--> statement-breakpoint
CREATE TABLE `ReadingHistory` (
	`id` text PRIMARY KEY NOT NULL,
	`articleId` text NOT NULL,
	`progress` real DEFAULT 0 NOT NULL,
	`shadowDone` integer DEFAULT false NOT NULL,
	`duration` integer DEFAULT 0 NOT NULL,
	`createdAt` integer NOT NULL,
	FOREIGN KEY (`articleId`) REFERENCES `Article`(`id`) ON UPDATE cascade ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `ReadingHistory_articleId_idx` ON `ReadingHistory` (`articleId`);--> statement-breakpoint
CREATE TABLE `ScrapeJob` (
	`id` text PRIMARY KEY NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`maxArticles` integer DEFAULT 5 NOT NULL,
	`createdCount` integer DEFAULT 0 NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`maxAttempts` integer DEFAULT 3 NOT NULL,
	`runAfter` integer NOT NULL,
	`lockedAt` integer,
	`lastError` text,
	`errorMessage` text,
	`startedAt` integer,
	`finishedAt` integer,
	`createdAt` integer NOT NULL,
	`updatedAt` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `ScrapeJob_status_runAfter_idx` ON `ScrapeJob` (`status`,`runAfter`);--> statement-breakpoint
CREATE INDEX `ScrapeJob_status_createdAt_idx` ON `ScrapeJob` (`status`,`createdAt`);--> statement-breakpoint
CREATE TABLE `Sentence` (
	`id` text PRIMARY KEY NOT NULL,
	`articleId` text NOT NULL,
	`index` integer NOT NULL,
	`text` text NOT NULL,
	`audioUrl` text,
	`wsjAudioUrl` text,
	`wsjAudioStartMs` integer,
	`wsjAudioEndMs` integer,
	`wsjAudioStatus` text DEFAULT 'pending' NOT NULL,
	FOREIGN KEY (`articleId`) REFERENCES `Article`(`id`) ON UPDATE cascade ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `Sentence_articleId_idx` ON `Sentence` (`articleId`);--> statement-breakpoint
CREATE TABLE `TrainingPackage` (
	`id` text PRIMARY KEY NOT NULL,
	`articleId` text NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`model` text,
	`promptVersion` text DEFAULT 'v1' NOT NULL,
	`payloadJson` text,
	`errorMessage` text,
	`createdAt` integer NOT NULL,
	`updatedAt` integer NOT NULL,
	FOREIGN KEY (`articleId`) REFERENCES `Article`(`id`) ON UPDATE cascade ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `TrainingPackage_articleId_key` ON `TrainingPackage` (`articleId`);--> statement-breakpoint
CREATE TABLE `Vocabulary` (
	`id` text PRIMARY KEY NOT NULL,
	`word` text NOT NULL,
	`definition` text,
	`context` text,
	`articleId` text,
	`mastered` integer DEFAULT false NOT NULL,
	`createdAt` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `Vocabulary_word_key` ON `Vocabulary` (`word`);--> statement-breakpoint
CREATE TABLE `WorkerHeartbeat` (
	`workerId` text PRIMARY KEY NOT NULL,
	`status` text NOT NULL,
	`stage` text,
	`message` text,
	`lastError` text,
	`metadataJson` text,
	`lastSeenAt` integer NOT NULL,
	`createdAt` integer NOT NULL,
	`updatedAt` integer NOT NULL
);
