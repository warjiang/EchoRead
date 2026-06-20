FROM debian:bookworm-slim

RUN apt-get update -y \
  && apt-get install -y --no-install-recommends \
    ca-certificates \
    chromium \
    curl \
    fonts-liberation \
  && rm -rf /var/lib/apt/lists/*

RUN mkdir -p /data/chrome-profile

EXPOSE 9222

CMD ["chromium", "--headless=new", "--no-sandbox", "--disable-dev-shm-usage", "--disable-gpu", "--remote-debugging-address=0.0.0.0", "--remote-debugging-port=9222", "--user-data-dir=/data/chrome-profile", "about:blank"]
