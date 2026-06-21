export interface ScrapedArticle {
  title: string;
  url: string;
  content: string;
  category?: string;
  publishedAt: Date;
}

interface WorkerArticle {
  title: string;
  url: string;
  content: string;
  category?: string | null;
  publishedAt?: string | null;
}

interface WorkerScrapeResponse {
  articles?: WorkerArticle[];
  error?: string;
}

function getWorkerUrl(): string {
  return process.env.WSJ_WORKER_URL || "http://wsj-worker:8000/scrape";
}

export async function scrapeWSJArticlesWithWorker(maxArticles = 5): Promise<ScrapedArticle[]> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  const secret = process.env.SCRAPER_WORKER_SECRET;
  if (secret) {
    headers.Authorization = `Bearer ${secret}`;
  }

  const response = await fetch(getWorkerUrl(), {
    method: "POST",
    headers,
    body: JSON.stringify({ maxArticles }),
  });

  const data = (await response.json()) as WorkerScrapeResponse;
  if (!response.ok) {
    throw new Error(data.error || `WSJ worker failed with ${response.status}`);
  }

  return (data.articles || []).map((article) => ({
    title: article.title,
    url: article.url,
    content: article.content,
    category: article.category || undefined,
    publishedAt: article.publishedAt ? new Date(article.publishedAt) : new Date(),
  }));
}
