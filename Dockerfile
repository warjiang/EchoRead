FROM node:20-slim

# Install Playwright dependencies
RUN apt-get update && apt-get install -y \
    wget \
    ca-certificates \
    fonts-liberation \
    libasound2 \
    libatk-bridge2.0-0 \
    libatk1.0-0 \
    libcups2 \
    libdbus-1-3 \
    libdrm2 \
    libgbm1 \
    libgtk-3-0 \
    libnspr4 \
    libnss3 \
    libxcomposite1 \
    libxdamage1 \
    libxrandr2 \
    xdg-utils \
    cron \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package*.json ./
RUN npm ci --only=production

COPY . .
RUN npx prisma generate
RUN npm run build

# Install Playwright browsers
RUN npx playwright install chromium

# Set up cron job for daily scraping (8 AM)
RUN echo "0 8 * * * cd /app && npx tsx scripts/cron-scrape.ts >> /var/log/scraper.log 2>&1" > /etc/cron.d/scraper
RUN chmod 0644 /etc/cron.d/scraper && crontab /etc/cron.d/scraper

EXPOSE 3000

CMD ["sh", "-c", "cron && npm start"]
