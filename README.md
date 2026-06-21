# 📖 Shadow Reading

English learning website powered by WSJ news articles with shadow reading practice.

## Features

- 📰 **Daily WSJ Articles** - Auto-scrape latest articles with Playwright
- 🎧 **Shadow Reading** - TTS sentence playback with speed control
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

# 4. Install edge-tts CLI (for TTS)
pip install edge-tts

# 5. Run development server
pnpm dev
```

Open [http://localhost:3000](http://localhost:3000)

## Usage

1. Click "Fetch New Articles" to scrape WSJ articles
2. Click an article to read it
3. Click "Start Shadow Reading" for TTS playback practice
4. Record yourself reading along and compare
5. Open article detail page to view the generated **Training Pack** section

## Browser-Use WSJ Collection

WSJ collection runs through a self-hosted browser-use worker. The Next.js app no longer drives Playwright directly for scraping.

- `chrome`: optional self-hosted Chromium with CDP on Docker-internal port `9222`
- `wsj-worker`: Python `browser-use[core]` service connected to `BROWSER_CDP_URL`, managed with `uv`
- `app`: Next.js service that calls `wsj-worker`, stores articles, and queues material generation

The Chrome profile is persisted at `./data/chrome-profile` when you use the bundled `chrome` service. Complete WSJ login once through the browser profile you expose to CDP, then subsequent collection jobs reuse that authenticated profile. This avoids Browser Use Cloud and keeps WSJ auth local to your deployment.

Important envs:

```bash
OPENAI_API_KEY=...
OPENAI_BASE_URL=https://api.openai.com/v1
SCRAPER_WORKER_SECRET=choose-a-secret
MATERIAL_WORKER_SECRET=choose-another-secret
BROWSER_AGENT_MODEL=gpt-4.1-mini
BROWSER_AGENT_BASE_URL=$OPENAI_BASE_URL
BROWSER_AGENT_API_KEY=$OPENAI_API_KEY
BROWSER_AGENT_RESPONSE_FORMAT=prompt_json
BROWSER_CDP_URL=http://chrome:9222
WSJ_WORKER_URL=http://wsj-worker:8000/scrape
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
BROWSER_AGENT_MODEL=deepseek-v4-flash
BROWSER_AGENT_RESPONSE_FORMAT=prompt_json
LLM_PROVIDER=openai-compatible
LLM_MODEL_HIGH_QUALITY=deepseek-v4-pro
LLM_BASE_URL=$OPENAI_BASE_URL
LLM_API_KEY=$OPENAI_API_KEY
LLM_RESPONSE_FORMAT=none
```

Use `BROWSER_AGENT_RESPONSE_FORMAT=prompt_json` for providers that do not support OpenAI `response_format.type=json_schema`. Set it to `json_schema` only for models/endpoints that support OpenAI structured outputs. Use `LLM_RESPONSE_FORMAT=json_object` only when the compatible provider supports OpenAI JSON mode. Otherwise keep `none`; EchoRead still extracts and validates the JSON object from the model text.

Manual worker checks:

```bash
docker compose exec chrome curl -fsS http://localhost:9222/json/version
curl -fsS http://localhost:8000/health
curl -fsS -X POST \
  -H "Authorization: Bearer $SCRAPER_WORKER_SECRET" \
  -H "Content-Type: application/json" \
  -d '{"maxArticles": 2}' \
  http://localhost:8000/scrape
```

Worker dependency changes should be made in `worker/wsj-worker/pyproject.toml`, then locked with:

```bash
cd worker/wsj-worker
uv lock
```

## LLM Training Pack Pipeline

This project supports async generation of a high-quality shadow-reading training package per article.

- Data models: `TrainingPackage` + `MaterialJob`
- Queue trigger: new article ingestion (`POST /api/scraper`)
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
- `wsj-worker`: browser-use worker for WSJ collection
- `app`: Next.js service (runs `prisma migrate deploy` on startup)
- `bootstrap-scrape`: one-shot job that calls `/api/scraper` after app is healthy

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
