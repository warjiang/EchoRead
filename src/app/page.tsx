import { prisma } from "@/lib/db";
import { ArticleCard } from "@/components/ArticleCard";
import { triggerScrape } from "@/app/actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { Newspaper, RefreshCw } from "lucide-react";

export default async function HomePage() {
  const articles = await prisma.article.findMany({
    orderBy: { publishedAt: "desc" },
    take: 20,
  });

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
        <form action={triggerScrape}>
          <Button type="submit" size="lg">
            <RefreshCw data-icon="inline-start" aria-hidden="true" />
            Fetch New Articles
          </Button>
        </form>
      </div>

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
          <EmptyContent>
            <form action={triggerScrape}>
              <Button type="submit">
                <RefreshCw data-icon="inline-start" aria-hidden="true" />
                Fetch New Articles
              </Button>
            </form>
          </EmptyContent>
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
