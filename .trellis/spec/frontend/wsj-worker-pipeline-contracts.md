# WSJ Worker Pipeline Contracts

## Scenario: Decoupled WSJ Queue Worker

### 1. Scope / Trigger

- Trigger: WSJ scraping or post-scrape processing crosses Prisma job tables, Next.js APIs, the TypeScript worker CLI, Python `wsj-worker`, Docker services, and local debug commands.
- Applies when changing scrape job creation, worker polling, Python worker URLs, post-scrape material/original-audio chaining, or Docker worker wiring.

### 2. Signatures

- DB:
  - `ScrapeJob.status` values are `pending`, `running`, `succeeded`, `failed`.
  - `ScrapeJob` owns scrape retry state through `attempts`, `maxAttempts`, `runAfter`, `lockedAt`, and `lastError`.
  - `WsjWorkerTask` is the only Python-bound durable channel. It stores `kind`, `domainJobId`, `domainAttempt`, `status`, `payloadJson`, `resultJson`, `lockedAt`, `lastError`, `startedAt`, `finishedAt`, `consumedAt`, and timestamps.
  - `WsjWorkerTask.kind` values are `scrape` and `audio`; `status` values are `pending`, `running`, `succeeded`, and `failed`.
  - `WsjWorkerTask` has a unique key on `kind + domainJobId + domainAttempt`.
- Next.js API:
  - `POST /api/scraper` accepts `{ maxArticles? }`, creates a pending `ScrapeJob`, and returns `202` without contacting Python.
  - Worker/callback API routes such as `/api/scraper/ingest`, `/api/materials/worker`, `/api/original-audio/worker`, and `/api/original-audio/ingest` do not exist.
- TypeScript worker:
  - `pnpm worker` runs the long-lived queue loop.
  - `pnpm worker:once` runs scrape, material, and original-audio processing once.
  - `pnpm worker:scrape`, `pnpm worker:materials`, and `pnpm worker:audio` run one stage once.
- Python worker:
  - `python -m app.runner` runs the DB-polling Python worker loop.
  - `python -m app.runner --once --stage scrape|audio|all` runs bounded debug passes.
  - Python reads and writes only `WsjWorkerTask` rows.

### 3. Contracts

- Next.js request handlers enqueue work only. They must not rely on `after()` to process scrape, material, or original-audio jobs.
- The TS worker is the primary orchestration path: claim domain jobs, create `WsjWorkerTask` rows for browser/audio work, then ingest completed task results through shared service functions.
- Python `wsj-worker` must not write application domain tables such as `ScrapeJob`, `Article`, `Sentence`, `ArticleAudioJob`, or `MaterialJob`.
- Required Docker worker env keys include `DATABASE_URL`, `BROWSER_CDP_URL`, `AUDIO_PUBLIC_DIR`, original-audio alignment/Whisper envs, `SCRAPER_WORKER_SECRET`, `MATERIAL_WORKER_SECRET`, and LLM envs needed by material generation.
- Do not introduce `WSJ_WORKER_URL`, `ORIGINAL_AUDIO_WORKER_URL`, callback URLs, or Python FastAPI routes for the worker pipeline.

### 4. Validation & Error Matrix

- Worker cannot claim a pending job atomically -> skip it; another worker may have claimed it.
- Python `scrape` task fails -> TS worker retries `ScrapeJob` until `maxAttempts`, then marks failed.
- Scrape succeeds with duplicate articles -> keep the scrape job succeeded; new article count may be zero.
- Material job failure -> retry/fail material state only; do not block original-audio jobs.
- Original-audio task result status `unavailable` -> mark article audio unavailable without consuming retries indefinitely.
- Original-audio task failure or result status `failed` -> retry/fail original-audio state per existing audio contract.
- Completed `WsjWorkerTask` whose `domainAttempt` no longer matches the domain job -> mark consumed and ignore as stale.

### 5. Good/Base/Bad Cases

- Good: `POST /api/scraper` returns quickly, `pnpm worker` claims the job and creates a `scrape` task, `python -m app.runner` completes it, then a later TS worker pass stores articles and advances material/audio jobs.
- Base: No new WSJ articles are found; scrape job succeeds with `createdCount = 0`.
- Base: App restarts after enqueue; pending jobs remain in SQLite and are processed when the worker restarts.
- Bad: Reintroducing `after()` means background work depends on a web request lifecycle and can disappear on deploy/restart.
- Bad: Python writes application domain tables directly, creating a second implementation of queue transitions.
- Bad: Python exposes HTTP worker routes again, making worker coordination depend on a live service endpoint instead of the durable DB task channel.

### 6. Tests Required

- Unit tests or smoke tests for `WsjWorkerTask` schema/claim/result/consume behavior.
- Tests that scraper/original-audio queue code does not call `fetch()` or read worker URL env vars.
- Type-check/lint must cover the TS worker CLI and shared queue services.
- Python tests must cover DB queue claim/complete/fail/recovery and audio result builders without invoking real Whisper or ffmpeg.
- Existing material and original-audio queue tests must pass after changing worker orchestration.
- Docker/docs changes must keep app, TS worker, and Python worker sharing the same SQLite and audio volumes.

### 7. Wrong vs Correct

#### Wrong

```typescript
after(async () => {
  await processMaterialJobs(2);
  await processArticleAudioJobs(2);
});
```

#### Correct

```typescript
await enqueueMaterialJob(article.id);
await enqueueArticleAudioJob(article.id);
// The standalone TS worker owns queue execution.
```

#### Wrong

```typescript
await fetch("http://wsj-worker:8000/scrape", { method: "POST", body });
```

#### Correct

```typescript
await db.insert(schema.scrapeJobs).values({ id, status: "pending", maxArticles });
// Later: TS worker creates WsjWorkerTask; Python worker polls SQLite and writes resultJson.
```

## Scenario: Pipeline Admin Console

### 1. Scope / Trigger

- Trigger: Admin management crosses auth sessions, Next.js route handlers/server actions, Drizzle job tables, article/material/audio state, filesystem cleanup, worker heartbeat, and persistent event logging.
- Applies when changing `/admin`, `/api/admin/*`, `PipelineEvent`, `WorkerHeartbeat`, destructive article/audio operations, or manual job retry/reset/fail behavior.

### 2. Signatures

- Env:
  - `ADMIN_EMAILS` is the comma/whitespace-separated allowlist for admin capability.
  - `AUTH_SESSION_COOKIE_NAME` defaults to `echoread_session`.
  - `AUTH_SESSION_MAX_AGE_SECONDS` defaults to `2592000`.
- DB:
  - `PipelineEvent` stores `scope`, `entityType`, optional `entityId` / `articleId` / `jobId`, `status`, `message`, optional `errorMessage`, optional `metadataJson`, optional `durationMs`, and `createdAt`.
  - `WorkerHeartbeat.workerId` is unique and stores the worker's `status`, `stage`, `message`, `lastError`, `metadataJson`, and `lastSeenAt`.
- API:
  - `POST /api/admin/login`, `POST /api/admin/logout`
  - `GET /api/admin/overview`, `GET /api/admin/jobs`, `GET /api/admin/articles`, `GET /api/admin/articles/:id`, `GET /api/admin/events`
  - `POST /api/admin/jobs/:type/:id/retry`, `POST /api/admin/jobs/:type/:id/reset`, `POST /api/admin/jobs/:type/:id/fail`
  - `PATCH /api/admin/articles/:id`, `DELETE /api/admin/articles/:id`
  - `POST /api/admin/articles/:id/materials/regenerate`
  - `POST /api/admin/articles/:id/original-audio/retry`, `POST /api/admin/articles/:id/original-audio/reset`

### 3. Contracts

- Admin is derived from a normal signed-in user whose normalized email is listed in `ADMIN_EMAILS`.
- Global login writes an httpOnly, same-site cookie containing an opaque session token; `AuthSession` stores only the token hash. Admin API routes must call `authorizeAdminRequest()`, and admin server actions must verify the current user has `canAdmin` before mutation.
- Admin routes call shared service functions in `src/lib/admin/service.ts`; do not duplicate Prisma queue state machines in route handlers.
- Manual destructive operations must write `PipelineEvent` records. For article deletion, write the event before deleting the article and omit `articleId` if the event should survive cascade deletion.
- `WorkerHeartbeat` is written by the standalone TS worker. The overview projection owns "online" calculation; React components should not call `Date.now()` during render.
- Manual retry is not allowed for active `running` / `processing` jobs. Manual reset/fail is allowed for inactive jobs or stale active locks only.
- Hard original-audio reset deletes `public/audio/wsj-source/<articleId>*` and `public/audio/wsj-clips/<articleId>/`, clears stored source/clip fields, resets sentence WSJ audio state to `pending`, then queues audio work.
- SQLite migrations that add a `DateTime @default(now())` column to an existing table must not use `ALTER TABLE ... ADD COLUMN ... DEFAULT CURRENT_TIMESTAMP`; SQLite rejects non-constant defaults. Add the column nullable, backfill with `CURRENT_TIMESTAMP`, and rely on Prisma to provide values on new writes, or rebuild the table if DB-level `NOT NULL` is required.

### 4. Validation & Error Matrix

- Missing/invalid auth cookie -> `401` from `/api/admin/*`; admin pages redirect to `/login?next=/admin`.
- Signed-in non-admin user -> `403` from `/api/admin/*`; admin pages/actions redirect to `/`.
- Invalid job type -> `400` from job mutation routes.
- Active non-stale job retry/reset/fail -> service throws; UI should disable those controls from the job projection.
- Article content edit -> replace sentence rows, mark training package pending, reset original-audio state, and enqueue material/audio regeneration.
- Article delete -> cascade DB records and remove source/clip audio paths.

### 5. Good/Base/Bad Cases

- Good: `/admin` shows heartbeat, queue counts, articles, material/audio status, and event history with no long-running work during render.
- Good: A failed audio job can be retried; a hard reset deletes old files and re-cuts clips from the standalone worker.
- Base: No worker heartbeat exists; overview reports offline without failing the page.
- Bad: Route handlers update Prisma job state directly instead of using admin services.
- Bad: Resetting a fresh running job kills in-flight worker work; only stale locks may be reset.

### 6. Tests Required

- Unit tests for user auth helpers, admin email allowlist, session hashing, and default cookie settings.
- Unit tests for event normalization and admin job retry/reset state helpers.
- Service or route tests for overview aggregation, job filters, article content edit dependency reset, article deletion cleanup, material regenerate, and original-audio retry/reset.
- Existing `tsc --noEmit`, `eslint`, scraper/material/original-audio tests, and Python worker tests must still pass.

### 7. Wrong vs Correct

#### Wrong

```typescript
export async function POST(_request: NextRequest, { params }: Params) {
  await prisma.materialJob.update({ where: { id: params.id }, data: { status: "pending" } });
  return NextResponse.json({ ok: true });
}
```

#### Correct

```typescript
export async function POST(request: NextRequest, { params }: Params) {
  const auth = await authorizeAdminRequest(request);
  if (!auth.ok) return adminAuthErrorResponse(auth);
  const { type, id } = await params;
  return NextResponse.json(await resetAdminJob(type, id));
}
```
