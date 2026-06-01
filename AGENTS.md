<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# EchoRead Agent Guide

This repository is a Next.js + Prisma + Playwright application for WSJ-based shadow reading.

## Tech + runtime baseline

- Node.js 20, Next.js 16, React 19, TypeScript strict mode
- Database: SQLite via Prisma
- Scraper: Playwright (local browser or remote websocket endpoint)
- Container runtime: app container + dedicated Playwright browser container

## Key project structure

- `src/app`: App Router pages and API routes
- `src/lib/db.ts`: Prisma client singleton
- `src/lib/scraper/wsj.ts`: WSJ login + scraping logic
- `prisma/schema.prisma`: DB schema
- `.github/workflows/ci.yml`: CI + image build/push policy
- `Dockerfile` and `docker-compose.yml`: production/container setup

## Environment variables that matter

- `DATABASE_URL` (required for build and runtime)
- `WSJ_EMAIL`, `WSJ_PASSWORD` (required for WSJ scraping)
- `WSJ_STORAGE_PATH` (persisted auth state path)
- `PLAYWRIGHT_WS_ENDPOINT` (optional remote browser endpoint)
- `TTS_PROVIDER`, `OPENAI_API_KEY`, `NEXT_PUBLIC_APP_URL`

## Local development workflow

1. Install dependencies: `pnpm install`
2. Prepare env: `cp .env.example .env`
3. Initialize DB for local dev: `pnpm prisma migrate dev`
4. Start app: `pnpm dev`

## Build and CI workflow

- Lint command: `pnpm lint`
- Build command: `pnpm build`
- CI-equivalent app build sequence:
  `DATABASE_URL=file:./prisma/ci.db pnpm prisma migrate deploy && pnpm build`
- Reason: some pages query Prisma during build; migrations must be applied first.

## Docker and deployment conventions

- Build stage must include OpenSSL (required by Prisma runtime/binaries).
- Docker build runs `prisma generate` and `prisma migrate deploy` before `next build`.
- Runtime command runs migrations before boot:
  `pnpm prisma migrate deploy && node server.js`
- Compose uses:
  - `browser`: Playwright run-server service
  - `app`: Next.js container, can use `PLAYWRIGHT_WS_ENDPOINT`
  - `bootstrap-scrape`: one-shot initialization scrape after app health check

## CI/CD policy (authoritative)

- Trigger events:
  - pull requests
  - pushes to `main`
  - pushes of tags matching `v*.*.*`
- `docker` job always builds image.
- Image push happens only for `push` events (not PR), targeting `ghcr.io/<owner>/echoread`.
- Expected tags include commit SHA; `latest` is emitted on default branch pushes.

## Change guardrails for agents

- Keep `DATABASE_URL` explicitly set in CI/build contexts.
- Avoid hardcoded insecure websocket scheme defaults in tracked config/examples.
- Keep scraper auth-state storage path stable and writable (`data/.wsj-auth.json` pattern).
- When modifying Prisma models used by pages, ensure migration flow remains valid in CI and Docker.
