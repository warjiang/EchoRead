-- AlterTable
ALTER TABLE "Sentence" ADD COLUMN "wsjAudioUrl" TEXT;
ALTER TABLE "Sentence" ADD COLUMN "wsjAudioStartMs" INTEGER;
ALTER TABLE "Sentence" ADD COLUMN "wsjAudioEndMs" INTEGER;
ALTER TABLE "Sentence" ADD COLUMN "wsjAudioStatus" TEXT NOT NULL DEFAULT 'pending';

-- CreateTable
CREATE TABLE "ArticleAudio" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "articleId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "sourceUrl" TEXT,
    "sourceAudioUrl" TEXT,
    "sourcePath" TEXT,
    "durationMs" INTEGER,
    "coverageRatio" REAL,
    "sentenceCount" INTEGER NOT NULL DEFAULT 0,
    "clippedCount" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "startedAt" DATETIME,
    "finishedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "ArticleAudio_articleId_fkey" FOREIGN KEY ("articleId") REFERENCES "Article" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ArticleAudioJob" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "articleId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "maxAttempts" INTEGER NOT NULL DEFAULT 3,
    "timeoutSeconds" INTEGER NOT NULL DEFAULT 300,
    "runAfter" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lockedAt" DATETIME,
    "workerJobId" TEXT,
    "lastError" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "ArticleAudioJob_articleId_fkey" FOREIGN KEY ("articleId") REFERENCES "Article" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "ArticleAudio_articleId_key" ON "ArticleAudio"("articleId");

-- CreateIndex
CREATE UNIQUE INDEX "ArticleAudioJob_articleId_key" ON "ArticleAudioJob"("articleId");

-- CreateIndex
CREATE INDEX "ArticleAudioJob_status_runAfter_idx" ON "ArticleAudioJob"("status", "runAfter");
