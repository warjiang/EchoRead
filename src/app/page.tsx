import type { Metadata } from "next";
import { desc } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth/session";
import { ArticleCard } from "@/components/ArticleCard";
import { triggerScrape } from "@/app/actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { Newspaper, RefreshCw } from "lucide-react";

export const metadata: Metadata = {
  title: {
    absolute: "Articles | EchoRead",
  },
  description:
    "Browse current WSJ articles prepared for EchoRead shadow reading practice.",
};

async function getLatestScrapeJob() {
  return db.query.scrapeJobs.findFirst({
    orderBy: desc(schema.scrapeJobs.createdAt),
  }).catch(() => null);
}

export default async function HomePage() {
  const [articles, latestScrapeJob, user] = await Promise.all([
    db.query.articles.findMany({
      orderBy: desc(schema.articles.publishedAt),
      limit: 20,
    }),
    getLatestScrapeJob(),
    getCurrentUser(),
  ]);
  const canAdmin = Boolean(user?.canAdmin);

  return (
    <div className="container-page py-8 sm:py-10">
      <div className="mb-8 flex flex-col gap-4 border-b pb-6 sm:flex-row sm:items-end sm:justify-between">
        <div className="flex max-w-2xl flex-col gap-3">
          <Badge variant="outline" className="w-fit">
            WSJ Practice Queue
          </Badge>
          <div className="flex flex-col gap-2">
            <h1 className="text-balance text-3xl font-semibold leading-tight tracking-normal text-foreground sm:text-4xl">
              Today&apos;s Articles
            </h1>
            <p className="text-sm leading-6 text-muted-foreground">
              Read current business news, then turn each story into focused
              shadow reading practice.
            </p>
          </div>
        </div>
        {canAdmin && (
          <form action={triggerScrape}>
            <Button type="submit" size="lg">
              <RefreshCw data-icon="inline-start" aria-hidden="true" />
              Fetch New Articles
            </Button>
          </form>
        )}
      </div>

      {latestScrapeJob && (
        <Alert
          variant={latestScrapeJob.status === "failed" ? "destructive" : "default"}
          className="mb-6"
        >
          <AlertTitle>Scrape job {latestScrapeJob.status}</AlertTitle>
          <AlertDescription>
            {latestScrapeJob.status === "succeeded"
              ? latestScrapeJob.createdCount > 0
                ? `Added ${latestScrapeJob.createdCount} new article${latestScrapeJob.createdCount === 1 ? "" : "s"}.`
                : "Finished, but no new articles were added. The worker may have collected articles already in the queue."
              : latestScrapeJob.errorMessage ||
                `Job ${latestScrapeJob.id} is collecting up to ${latestScrapeJob.maxArticles} articles.`}
          </AlertDescription>
        </Alert>
      )}

      {articles.length === 0 ? (
        <Empty className="min-h-[360px] border">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <Newspaper aria-hidden="true" />
            </EmptyMedia>
            <EmptyTitle>No Articles Yet</EmptyTitle>
            <EmptyDescription>
              Fetch new articles to build the reading queue.
            </EmptyDescription>
          </EmptyHeader>
          {canAdmin && (
            <EmptyContent>
              <form action={triggerScrape}>
                <Button type="submit">
                  <RefreshCw data-icon="inline-start" aria-hidden="true" />
                  Fetch New Articles
                </Button>
              </form>
            </EmptyContent>
          )}
        </Empty>
      ) : (
        <div className="grid gap-3">
          {articles.map((article) => (
            <ArticleCard
              key={article.id}
              id={article.id}
              title={article.title}
              category={article.category}
              difficulty={article.difficulty}
              publishedAt={article.publishedAt.toISOString()}
              summary={article.summary}
            />
          ))}
        </div>
      )}
    </div>
  );
}
