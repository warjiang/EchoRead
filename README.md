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
pnpm prisma migrate dev

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
- `app`: Next.js service (runs `prisma migrate deploy` on startup)
- `browser`: dedicated Playwright browser container
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
