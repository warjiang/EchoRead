# 📖 Shadow Reading

English learning website powered by WSJ news articles with shadow reading practice.

## Features

- 📰 **Daily WSJ Articles** - Auto-scrape latest articles with Playwright
- 🎧 **Shadow Reading** - WSJ original narration clipped into sentence-level practice audio
- 🎤 **Recording & Comparison** - Record yourself and compare with original
- 📖 **Vocabulary Book** - Click words to look up and save
- 📊 **Progress Tracking** - Learning history and statistics

## Quick Start

```bash
# 1. Install dependencies
pnpm install

# 2. Set up environment variables
cp .env.example .env
# Edit .env with your WSJ credentials

# 3. Initialize database
pnpm exec prisma migrate dev

# 4. Run development server
pnpm dev
```

Open [http://localhost:3000](http://localhost:3000)

## Usage

1. Click "Fetch New Articles" to scrape WSJ articles
2. Click an article to read it
3. Click "Start Shadow Reading" when WSJ original audio clips are ready
4. Record yourself reading along and compare
5. Open article detail page to view the generated **Training Pack** section

## Deterministic WSJ Collection

WSJ collection runs through a self-hosted worker that uses Playwright over CDP plus deterministic DOM / JSON-LD extraction. LLMs are not used for scraping; they are only used later for shadow-reading material generation.

- `chrome`: optional self-hosted Chromium with CDP on Docker-internal port `9222`
- `wsj-worker`: Python Playwright service connected to `BROWSER_CDP_URL`, managed with `uv`
- `app`: Next.js service that creates scrape jobs, receives worker callbacks, stores articles, and queues material and original-audio generation

The Chrome profile is persisted at `./data/chrome-profile` when you use the bundled `chrome` service. Complete WSJ login once through the browser profile you expose to CDP, then subsequent collection jobs reuse that authenticated profile. This keeps WSJ auth local to your deployment.

Important envs:

```bash
OPENAI_API_KEY=...
OPENAI_BASE_URL=https://api.openai.com/v1
SCRAPER_WORKER_SECRET=choose-a-secret
MATERIAL_WORKER_SECRET=choose-another-secret
BROWSER_CDP_URL=http://chrome:9222
WSJ_WORKER_URL=http://wsj-worker:8000/jobs
ORIGINAL_AUDIO_WORKER_URL=http://wsj-worker:8000/audio/jobs
ORIGINAL_AUDIO_MIN_COVERAGE=0.9
ORIGINAL_AUDIO_MAX_ATTEMPTS=3
ORIGINAL_AUDIO_TIMEOUT_SECONDS=300
ORIGINAL_AUDIO_ALIGNMENT_MIN_SCORE=0.62
ORIGINAL_AUDIO_ALIGNMENT_SEARCH_WORDS=240
ORIGINAL_AUDIO_ALIGNMENT_INITIAL_SEARCH_WORDS=480
AUDIO_PUBLIC_DIR=./public/audio
SCRAPER_CALLBACK_BASE_URL=http://app:3000
```

Use only `BROWSER_CDP_URL` to choose the browser:

```bash
# Bundled docker-compose chrome service
BROWSER_CDP_URL=http://chrome:9222

# CDP browser already running on the Docker host
BROWSER_CDP_URL=http://host.docker.internal:9222

# Local uv worker connecting to a local browser
BROWSER_CDP_URL=http://127.0.0.1:9222
```

For an OpenAI-compatible provider, set the base URL to the prefix before `/chat/completions`. For example, Volcengine Ark:

```bash
OPENAI_API_KEY=$API_KEY
OPENAI_BASE_URL=https://ark.cn-beijing.volces.com/api/plan/v3
LLM_PROVIDER=openai-compatible
LLM_MODEL_HIGH_QUALITY=deepseek-v4-pro
LLM_BASE_URL=$OPENAI_BASE_URL
LLM_API_KEY=$OPENAI_API_KEY
LLM_RESPONSE_FORMAT=none
```

Use `LLM_RESPONSE_FORMAT=json_object` only when the compatible provider supports OpenAI JSON mode. Otherwise keep `none`; EchoRead still extracts and validates the JSON object from the model text. `BROWSER_AGENT_*` settings are no longer used by scraping.

Manual worker checks:

```bash
docker compose exec chrome curl -fsS http://localhost:9222/json/version
curl -fsS http://localhost:8000/health

# Start an async scrape job through the app. The response includes jobId.
curl -fsS -X POST \
  -H "Authorization: Bearer $SCRAPER_WORKER_SECRET" \
  -H "Content-Type: application/json" \
  -d '{"maxArticles": 2}' \
  http://localhost:3000/api/scraper

# Check job status.
curl -fsS \
  -H "Authorization: Bearer $SCRAPER_WORKER_SECRET" \
  http://localhost:3000/api/scraper/jobs/<jobId>

# Synchronous worker check, useful for debugging deterministic extraction.
curl -fsS -X POST \
  -H "Authorization: Bearer $SCRAPER_WORKER_SECRET" \
  -H "Content-Type: application/json" \
  -d '{"maxArticles": 2}' \
  http://localhost:8000/scrape
```

The app no longer waits for WSJ collection to finish. `POST /api/scraper` creates a `ScrapeJob`, asks `wsj-worker` to run in the background, and returns `202` immediately. The worker posts `running`, `succeeded`, or `failed` updates back to `POST /api/scraper/ingest` with the same `SCRAPER_WORKER_SECRET`.

When running outside Docker, make sure `SCRAPER_CALLBACK_BASE_URL` points to an address the worker can reach. For local app + local worker, `http://localhost:3000` is fine. In Docker Compose, use `http://app:3000`.

## WSJ Original Audio Pipeline

New articles automatically queue original-audio processing after scrape ingestion. The `wsj-worker` uses the authenticated WSJ browser context to find accessible article narration, downloads the full source file, aligns it to stored article sentences, and writes sentence clips for shadow reading.

Storage paths:

```bash
public/audio/wsj-source/<articleId>.<ext>
public/audio/wsj-clips/<articleId>/<sentenceId>.mp3
```

For manual local worker runs, use `AUDIO_PUBLIC_DIR=./public/audio` or leave it unset. Docker Compose overrides it to `/app/public/audio` so the app and worker share the mounted volume.

Manual local worker runs also need `ffmpeg` and `ffprobe` on PATH for sentence clipping:

```bash
brew install ffmpeg
```

If they are installed somewhere custom, set:

```bash
FFMPEG_BINARY=/path/to/ffmpeg
FFPROBE_BINARY=/path/to/ffprobe
```

Readiness is based on sentence clip coverage. By default, at least 90% of stored sentences must have clips before the article's shadow-reading entry is enabled. Articles without accessible WSJ narration remain readable, but their shadow-reading controls show unavailable, processing, or failed state instead of falling back to TTS.

Alignment is text-similarity based instead of token-count based, so the worker can skip WSJ audio intros, titles, or small narration edits before cutting clips. `ORIGINAL_AUDIO_ALIGNMENT_MIN_SCORE` controls how strict each sentence match is. `ORIGINAL_AUDIO_ALIGNMENT_SEARCH_WORDS` controls how far the worker scans ahead from the previous matched sentence, while `ORIGINAL_AUDIO_ALIGNMENT_INITIAL_SEARCH_WORDS` gives the first sentence a larger window for title/intro audio.

Manual retry is available from the article page when original-audio processing fails, and through:

```bash
curl -fsS -X POST \
  -H "Authorization: Bearer $SCRAPER_WORKER_SECRET" \
  -H "Content-Type: application/json" \
  -d '{"timeoutSeconds": 600}' \
  http://localhost:3000/api/articles/<articleId>/original-audio/retry
```

Pending original-audio jobs can be kicked manually, which is useful when the app or worker was restarted after scrape ingestion:

```bash
curl -fsS -X POST \
  -H "Authorization: Bearer $SCRAPER_WORKER_SECRET" \
  http://localhost:3000/api/original-audio/worker?limit=3
```

The full source audio is retained for local processing and possible re-clipping. EchoRead does not add a user-facing download action for the full source file. Use this only with audio available to your authenticated WSJ session and your own local learning deployment; the worker must not bypass WSJ access controls.

Worker dependency changes should be made in `worker/wsj-worker/pyproject.toml`, then locked with:

```bash
cd worker/wsj-worker
uv lock
```

## LLM Training Pack Pipeline

This project supports async generation of a high-quality shadow-reading training package per article.

- Data models: `TrainingPackage` + `MaterialJob`
- Queue trigger: new article ingestion from async WSJ scrape callbacks
- Worker endpoint: `POST /api/materials/worker?limit=2`
- Regenerate endpoint: `POST /api/articles/:id/materials/regenerate`
- Query endpoint: `GET /api/articles/:id/materials`

Required envs for material generation:

```bash
LLM_PROVIDER=openai-compatible
LLM_MODEL_HIGH_QUALITY=deepseek-v4-pro
LLM_BASE_URL=https://ark.cn-beijing.volces.com/api/plan/v3
LLM_API_KEY=...
```

Worker protection:

```bash
MATERIAL_WORKER_SECRET=...
SCRAPER_WORKER_SECRET=...
```

## Docker Deployment

```bash
# 1) Configure credentials
cp .env.example .env
# Edit .env and set WSJ_EMAIL / WSJ_PASSWORD

# 2) Local image build + startup (app + browser + initial scrape)
docker compose up --build -d

# 3) Check initial scrape logs
docker compose logs -f bootstrap-scrape
```

Compose now starts:
- `chrome`: dedicated CDP Chromium with persisted profile
- `wsj-worker`: deterministic Playwright worker for WSJ collection
- `app`: Next.js service (runs `prisma migrate deploy` on startup)
- `bootstrap-scrape`: one-shot job that creates an async scrape job after app is healthy

## One-Click Deploy (Prebuilt Image)

```bash
# 1) Configure credentials
cp .env.example .env
# Edit .env and set WSJ_EMAIL / WSJ_PASSWORD

# 2) One-command deploy (pull latest image + start)
docker compose -f docker-compose.deploy.yml up -d

# 3) Check initialization logs
docker compose -f docker-compose.deploy.yml logs -f bootstrap-scrape
```

`docker-compose.deploy.yml` pulls image from `ECHOREAD_IMAGE` (default: `ghcr.io/warjiang/echoread:latest`) and starts all required services.

## Tech Stack

- **Frontend**: Next.js 14, React, Tailwind CSS
- **Backend**: Next.js API Routes
- **Database**: SQLite + Prisma
- **Scraper**: Playwright
- **TTS**: Edge TTS (Microsoft)
- **Audio**: Web Audio API + MediaRecorder

```bash
pnpm dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.
