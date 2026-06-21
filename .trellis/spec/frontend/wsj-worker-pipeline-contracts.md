# WSJ Worker Pipeline Contracts

## Scenario: Decoupled WSJ Queue Worker

### 1. Scope / Trigger

- Trigger: WSJ scraping or post-scrape processing crosses Prisma job tables, Next.js APIs, the TypeScript worker CLI, Python `wsj-worker`, Docker services, and local debug commands.
- Applies when changing scrape job creation, worker polling, Python worker URLs, post-scrape material/original-audio chaining, or Docker worker wiring.

### 2. Signatures

- DB:
  - `ScrapeJob.status` values are `pending`, `running`, `succeeded`, `failed`.
  - `ScrapeJob` owns scrape retry state through `attempts`, `maxAttempts`, `runAfter`, `lockedAt`, and `lastError`.
- Next.js API:
  - `POST /api/scraper` accepts `{ maxArticles? }`, creates a pending `ScrapeJob`, and returns `202` without contacting Python.
  - `POST /api/scraper/ingest` remains a compatibility callback endpoint for `{ jobId, status, articles?, errorMessage? }`.
- TypeScript worker:
  - `pnpm worker` runs the long-lived queue loop.
  - `pnpm worker:once` runs scrape, material, and original-audio processing once.
  - `pnpm worker:scrape`, `pnpm worker:materials`, and `pnpm worker:audio` run one stage once.
- Python worker:
  - `POST /scrape` accepts `{ maxArticles }` and returns `{ articles }`.
  - `POST /audio/process` accepts the existing original-audio job payload and returns the existing audio callback payload synchronously.
  - `POST /jobs` and `POST /audio/jobs` remain callback-compatible legacy endpoints.

### 3. Contracts

- Next.js request handlers enqueue work only. They must not rely on `after()` to process scrape, material, or original-audio jobs.
- The TS worker is the primary orchestration path: claim Prisma jobs, call Python when browser/audio work is required, then update Prisma through shared service functions.
- Python `wsj-worker` must not write application database state; it only returns scrape/audio payloads or posts compatibility callbacks.
- Required Docker worker env keys include `DATABASE_URL`, `WSJ_WORKER_URL`, `ORIGINAL_AUDIO_WORKER_URL`, `SCRAPER_WORKER_SECRET`, `MATERIAL_WORKER_SECRET`, and LLM envs needed by material generation.
- Primary Docker URLs are `WSJ_WORKER_URL=http://wsj-worker:8000/scrape` and `ORIGINAL_AUDIO_WORKER_URL=http://wsj-worker:8000/audio/process`.

### 4. Validation & Error Matrix

- Worker cannot claim a pending job atomically -> skip it; another worker may have claimed it.
- Python `/scrape` rejects or times out -> retry `ScrapeJob` until `maxAttempts`, then mark failed.
- Scrape succeeds with duplicate articles -> keep the scrape job succeeded; new article count may be zero.
- Material job failure -> retry/fail material state only; do not block original-audio jobs.
- Original-audio worker returns `unavailable` -> mark article audio unavailable without consuming retries indefinitely.
- Original-audio worker returns `failed` or rejects -> retry/fail original-audio state per existing audio contract.

### 5. Good/Base/Bad Cases

- Good: `POST /api/scraper` returns quickly, `pnpm worker` claims the job, stores articles, and advances material/audio jobs.
- Base: No new WSJ articles are found; scrape job succeeds with `createdCount = 0`.
- Base: App restarts after enqueue; pending jobs remain in SQLite and are processed when the worker restarts.
- Bad: Reintroducing `after()` means background work depends on a web request lifecycle and can disappear on deploy/restart.
- Bad: Python writes Prisma state directly, creating a second implementation of queue transitions.

### 6. Tests Required

- Unit tests for worker URL normalization from `/jobs` or `/audio/jobs` to the synchronous endpoints.
- Type-check/lint must cover the TS worker CLI and shared queue services.
- Python tests must cover `/audio/process` without invoking real Whisper or ffmpeg.
- Existing material and original-audio queue tests must pass after changing worker orchestration.
- Docker/docs changes must keep app and worker env URLs consistent.

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
await fetch("http://wsj-worker:8000/jobs", { method: "POST", body });
```

#### Correct

```typescript
await prisma.scrapeJob.create({ data: { status: "pending", maxArticles } });
// Later: worker claims the job and calls Python /scrape.
```

## Scenario: Pipeline Admin Console

### 1. Scope / Trigger

- Trigger: Admin management crosses auth cookies, Next.js route handlers/server actions, Prisma job tables, article/material/audio state, filesystem cleanup, worker heartbeat, and persistent event logging.
- Applies when changing `/admin`, `/api/admin/*`, `PipelineEvent`, `WorkerHeartbeat`, destructive article/audio operations, or manual job retry/reset/fail behavior.

### 2. Signatures

- Env:
  - `ADMIN_SECRET` enables production admin access.
  - `ADMIN_SESSION_COOKIE_NAME` defaults to `echoread_admin`.
  - `ADMIN_SESSION_MAX_AGE_SECONDS` defaults to `86400`.
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

- Production admin is disabled when `ADMIN_SECRET` is missing. Development may use the built-in dev session secret.
- Admin login writes an httpOnly, same-site cookie. Admin API routes must call `isAdminRequest()`, and admin server actions must call `hasAdminSession()` before mutation.
- Admin routes call shared service functions in `src/lib/admin/service.ts`; do not duplicate Prisma queue state machines in route handlers.
- Manual destructive operations must write `PipelineEvent` records. For article deletion, write the event before deleting the article and omit `articleId` if the event should survive cascade deletion.
- `WorkerHeartbeat` is written by the standalone TS worker. The overview projection owns "online" calculation; React components should not call `Date.now()` during render.
- Manual retry is not allowed for active `running` / `processing` jobs. Manual reset/fail is allowed for inactive jobs or stale active locks only.
- Hard original-audio reset deletes `public/audio/wsj-source/<articleId>*` and `public/audio/wsj-clips/<articleId>/`, clears stored source/clip fields, resets sentence WSJ audio state to `pending`, then queues audio work.
- SQLite migrations that add a `DateTime @default(now())` column to an existing table must not use `ALTER TABLE ... ADD COLUMN ... DEFAULT CURRENT_TIMESTAMP`; SQLite rejects non-constant defaults. Add the column nullable, backfill with `CURRENT_TIMESTAMP`, and rely on Prisma to provide values on new writes, or rebuild the table if DB-level `NOT NULL` is required.

### 4. Validation & Error Matrix

- Missing/invalid admin cookie -> `401` from `/api/admin/*`; admin pages redirect to `/admin/login`.
- Missing `ADMIN_SECRET` in production -> admin login returns disabled state and no session cookie is issued.
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

- Unit tests for admin auth secret/session behavior and default cookie settings.
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
  if (!isAdminRequest(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { type, id } = await params;
  return NextResponse.json(await resetAdminJob(type, id));
}
```
