import { relations } from "drizzle-orm";
import {
  index,
  integer,
  real,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

const timestamp = (name: string) => integer(name, { mode: "timestamp_ms" });

export const articles = sqliteTable(
  "Article",
  {
    id: text("id").primaryKey(),
    title: text("title").notNull(),
    url: text("url").notNull(),
    content: text("content").notNull(),
    summary: text("summary"),
    category: text("category"),
    difficulty: text("difficulty"),
    publishedAt: timestamp("publishedAt").notNull(),
    createdAt: timestamp("createdAt").notNull().$defaultFn(() => new Date()),
  },
  (table) => ({
    urlKey: uniqueIndex("Article_url_key").on(table.url),
  })
);

export const sentences = sqliteTable(
  "Sentence",
  {
    id: text("id").primaryKey(),
    articleId: text("articleId")
      .notNull()
      .references(() => articles.id, { onDelete: "cascade", onUpdate: "cascade" }),
    index: integer("index").notNull(),
    text: text("text").notNull(),
    audioUrl: text("audioUrl"),
    wsjAudioUrl: text("wsjAudioUrl"),
    wsjAudioStartMs: integer("wsjAudioStartMs"),
    wsjAudioEndMs: integer("wsjAudioEndMs"),
    wsjAudioStatus: text("wsjAudioStatus").notNull().default("pending"),
  },
  (table) => ({
    articleIdIdx: index("Sentence_articleId_idx").on(table.articleId),
  })
);

export const vocabulary = sqliteTable(
  "Vocabulary",
  {
    id: text("id").primaryKey(),
    word: text("word").notNull(),
    definition: text("definition"),
    context: text("context"),
    articleId: text("articleId"),
    mastered: integer("mastered", { mode: "boolean" }).notNull().default(false),
    createdAt: timestamp("createdAt").notNull().$defaultFn(() => new Date()),
  },
  (table) => ({
    wordKey: uniqueIndex("Vocabulary_word_key").on(table.word),
  })
);

export const readingHistory = sqliteTable(
  "ReadingHistory",
  {
    id: text("id").primaryKey(),
    articleId: text("articleId")
      .notNull()
      .references(() => articles.id, { onDelete: "cascade", onUpdate: "cascade" }),
    progress: real("progress").notNull().default(0),
    shadowDone: integer("shadowDone", { mode: "boolean" }).notNull().default(false),
    duration: integer("duration").notNull().default(0),
    createdAt: timestamp("createdAt").notNull().$defaultFn(() => new Date()),
  },
  (table) => ({
    articleIdIdx: index("ReadingHistory_articleId_idx").on(table.articleId),
  })
);

export const scrapeJobs = sqliteTable(
  "ScrapeJob",
  {
    id: text("id").primaryKey(),
    status: text("status").notNull().default("pending"),
    maxArticles: integer("maxArticles").notNull().default(5),
    createdCount: integer("createdCount").notNull().default(0),
    attempts: integer("attempts").notNull().default(0),
    maxAttempts: integer("maxAttempts").notNull().default(3),
    runAfter: timestamp("runAfter").notNull().$defaultFn(() => new Date()),
    lockedAt: timestamp("lockedAt"),
    lastError: text("lastError"),
    errorMessage: text("errorMessage"),
    startedAt: timestamp("startedAt"),
    finishedAt: timestamp("finishedAt"),
    createdAt: timestamp("createdAt").notNull().$defaultFn(() => new Date()),
    updatedAt: timestamp("updatedAt").notNull().$defaultFn(() => new Date()),
  },
  (table) => ({
    statusRunAfterIdx: index("ScrapeJob_status_runAfter_idx").on(table.status, table.runAfter),
    statusCreatedAtIdx: index("ScrapeJob_status_createdAt_idx").on(table.status, table.createdAt),
  })
);

export const trainingPackages = sqliteTable(
  "TrainingPackage",
  {
    id: text("id").primaryKey(),
    articleId: text("articleId")
      .notNull()
      .references(() => articles.id, { onDelete: "cascade", onUpdate: "cascade" }),
    version: integer("version").notNull().default(1),
    status: text("status").notNull().default("pending"),
    model: text("model"),
    promptVersion: text("promptVersion").notNull().default("v1"),
    payloadJson: text("payloadJson"),
    errorMessage: text("errorMessage"),
    createdAt: timestamp("createdAt").notNull().$defaultFn(() => new Date()),
    updatedAt: timestamp("updatedAt").notNull().$defaultFn(() => new Date()),
  },
  (table) => ({
    articleIdKey: uniqueIndex("TrainingPackage_articleId_key").on(table.articleId),
  })
);

export const materialJobs = sqliteTable(
  "MaterialJob",
  {
    id: text("id").primaryKey(),
    articleId: text("articleId")
      .notNull()
      .references(() => articles.id, { onDelete: "cascade", onUpdate: "cascade" }),
    jobType: text("jobType").notNull().default("full_training_pack"),
    status: text("status").notNull().default("pending"),
    attempts: integer("attempts").notNull().default(0),
    maxAttempts: integer("maxAttempts").notNull().default(3),
    runAfter: timestamp("runAfter").notNull().$defaultFn(() => new Date()),
    lockedAt: timestamp("lockedAt"),
    lastError: text("lastError"),
    createdAt: timestamp("createdAt").notNull().$defaultFn(() => new Date()),
    updatedAt: timestamp("updatedAt").notNull().$defaultFn(() => new Date()),
  },
  (table) => ({
    statusRunAfterIdx: index("MaterialJob_status_runAfter_idx").on(table.status, table.runAfter),
    articleJobTypeKey: uniqueIndex("MaterialJob_articleId_jobType_key").on(table.articleId, table.jobType),
  })
);

export const articleAudio = sqliteTable(
  "ArticleAudio",
  {
    id: text("id").primaryKey(),
    articleId: text("articleId")
      .notNull()
      .references(() => articles.id, { onDelete: "cascade", onUpdate: "cascade" }),
    status: text("status").notNull().default("pending"),
    sourceUrl: text("sourceUrl"),
    sourceAudioUrl: text("sourceAudioUrl"),
    sourcePath: text("sourcePath"),
    durationMs: integer("durationMs"),
    coverageRatio: real("coverageRatio"),
    sentenceCount: integer("sentenceCount").notNull().default(0),
    clippedCount: integer("clippedCount").notNull().default(0),
    lastError: text("lastError"),
    startedAt: timestamp("startedAt"),
    finishedAt: timestamp("finishedAt"),
    createdAt: timestamp("createdAt").notNull().$defaultFn(() => new Date()),
    updatedAt: timestamp("updatedAt").notNull().$defaultFn(() => new Date()),
  },
  (table) => ({
    articleIdKey: uniqueIndex("ArticleAudio_articleId_key").on(table.articleId),
  })
);

export const articleAudioJobs = sqliteTable(
  "ArticleAudioJob",
  {
    id: text("id").primaryKey(),
    articleId: text("articleId")
      .notNull()
      .references(() => articles.id, { onDelete: "cascade", onUpdate: "cascade" }),
    status: text("status").notNull().default("pending"),
    attempts: integer("attempts").notNull().default(0),
    maxAttempts: integer("maxAttempts").notNull().default(3),
    timeoutSeconds: integer("timeoutSeconds").notNull().default(300),
    runAfter: timestamp("runAfter").notNull().$defaultFn(() => new Date()),
    lockedAt: timestamp("lockedAt"),
    workerJobId: text("workerJobId"),
    lastError: text("lastError"),
    createdAt: timestamp("createdAt").notNull().$defaultFn(() => new Date()),
    updatedAt: timestamp("updatedAt").notNull().$defaultFn(() => new Date()),
  },
  (table) => ({
    articleIdKey: uniqueIndex("ArticleAudioJob_articleId_key").on(table.articleId),
    statusRunAfterIdx: index("ArticleAudioJob_status_runAfter_idx").on(table.status, table.runAfter),
  })
);

export const pipelineEvents = sqliteTable(
  "PipelineEvent",
  {
    id: text("id").primaryKey(),
    scope: text("scope").notNull(),
    entityType: text("entityType").notNull(),
    entityId: text("entityId"),
    articleId: text("articleId").references(() => articles.id, { onDelete: "cascade", onUpdate: "cascade" }),
    jobId: text("jobId"),
    status: text("status").notNull(),
    message: text("message").notNull(),
    errorMessage: text("errorMessage"),
    metadataJson: text("metadataJson"),
    durationMs: integer("durationMs"),
    createdAt: timestamp("createdAt").notNull().$defaultFn(() => new Date()),
  },
  (table) => ({
    scopeCreatedAtIdx: index("PipelineEvent_scope_createdAt_idx").on(table.scope, table.createdAt),
    entityIdx: index("PipelineEvent_entityType_entityId_idx").on(table.entityType, table.entityId),
    articleCreatedAtIdx: index("PipelineEvent_articleId_createdAt_idx").on(table.articleId, table.createdAt),
    jobCreatedAtIdx: index("PipelineEvent_jobId_createdAt_idx").on(table.jobId, table.createdAt),
  })
);

export const workerHeartbeats = sqliteTable("WorkerHeartbeat", {
  workerId: text("workerId").primaryKey(),
  status: text("status").notNull(),
  stage: text("stage"),
  message: text("message"),
  lastError: text("lastError"),
  metadataJson: text("metadataJson"),
  lastSeenAt: timestamp("lastSeenAt").notNull().$defaultFn(() => new Date()),
  createdAt: timestamp("createdAt").notNull().$defaultFn(() => new Date()),
  updatedAt: timestamp("updatedAt").notNull().$defaultFn(() => new Date()),
});

export const articleRelations = relations(articles, ({ many, one }) => ({
  sentences: many(sentences),
  readings: many(readingHistory),
  materialJobs: many(materialJobs),
  pipelineEvents: many(pipelineEvents),
  trainingPackage: one(trainingPackages, {
    fields: [articles.id],
    references: [trainingPackages.articleId],
  }),
  originalAudio: one(articleAudio, {
    fields: [articles.id],
    references: [articleAudio.articleId],
  }),
  originalAudioJob: one(articleAudioJobs, {
    fields: [articles.id],
    references: [articleAudioJobs.articleId],
  }),
}));

export const sentenceRelations = relations(sentences, ({ one }) => ({
  article: one(articles, { fields: [sentences.articleId], references: [articles.id] }),
}));

export const readingHistoryRelations = relations(readingHistory, ({ one }) => ({
  article: one(articles, { fields: [readingHistory.articleId], references: [articles.id] }),
}));

export const trainingPackageRelations = relations(trainingPackages, ({ one }) => ({
  article: one(articles, { fields: [trainingPackages.articleId], references: [articles.id] }),
}));

export const materialJobRelations = relations(materialJobs, ({ one }) => ({
  article: one(articles, { fields: [materialJobs.articleId], references: [articles.id] }),
}));

export const articleAudioRelations = relations(articleAudio, ({ one }) => ({
  article: one(articles, { fields: [articleAudio.articleId], references: [articles.id] }),
}));

export const articleAudioJobRelations = relations(articleAudioJobs, ({ one }) => ({
  article: one(articles, { fields: [articleAudioJobs.articleId], references: [articles.id] }),
}));

export const pipelineEventRelations = relations(pipelineEvents, ({ one }) => ({
  article: one(articles, { fields: [pipelineEvents.articleId], references: [articles.id] }),
}));

export type Article = typeof articles.$inferSelect;
export type NewArticle = typeof articles.$inferInsert;
export type Sentence = typeof sentences.$inferSelect;
export type Vocabulary = typeof vocabulary.$inferSelect;
export type ReadingHistory = typeof readingHistory.$inferSelect;
export type ScrapeJob = typeof scrapeJobs.$inferSelect;
export type TrainingPackage = typeof trainingPackages.$inferSelect;
export type MaterialJob = typeof materialJobs.$inferSelect;
export type ArticleAudio = typeof articleAudio.$inferSelect;
export type ArticleAudioJob = typeof articleAudioJobs.$inferSelect;
export type PipelineEvent = typeof pipelineEvents.$inferSelect;
export type WorkerHeartbeat = typeof workerHeartbeats.$inferSelect;
