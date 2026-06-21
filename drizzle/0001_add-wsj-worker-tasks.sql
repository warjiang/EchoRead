CREATE TABLE `WsjWorkerTask` (
	`id` text PRIMARY KEY NOT NULL,
	`kind` text NOT NULL,
	`domainJobId` text NOT NULL,
	`domainAttempt` integer NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`payloadJson` text NOT NULL,
	`resultJson` text,
	`lockedAt` integer,
	`lastError` text,
	`startedAt` integer,
	`finishedAt` integer,
	`consumedAt` integer,
	`createdAt` integer NOT NULL,
	`updatedAt` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `WsjWorkerTask_kind_status_createdAt_idx` ON `WsjWorkerTask` (`kind`,`status`,`createdAt`);--> statement-breakpoint
CREATE UNIQUE INDEX `WsjWorkerTask_kind_domainJobId_domainAttempt_key` ON `WsjWorkerTask` (`kind`,`domainJobId`,`domainAttempt`);