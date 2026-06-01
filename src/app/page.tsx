import { prisma } from "@/lib/db";
import { ArticleCard } from "@/components/ArticleCard";
import { Newspaper, RefreshCw } from "lucide-react";

export default async function HomePage() {
  const articles = await prisma.article.findMany({
    orderBy: { publishedAt: "desc" },
    take: 20,
  });

  return (
    <div className="max-w-4xl mx-auto px-4 py-8">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
            <Newspaper className="w-6 h-6 text-blue-600" />
            Today&apos;s Articles
          </h1>
          <p className="text-sm text-gray-500 mt-1">
            Read WSJ articles and practice shadow reading
          </p>
        </div>
        <form action="/api/scraper" method="post">
          <button
            type="submit"
            className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 text-sm"
          >
            <RefreshCw className="w-4 h-4" />
            Fetch New Articles
          </button>
        </form>
      </div>

      {articles.length === 0 ? (
        <div className="text-center py-16">
          <Newspaper className="w-16 h-16 text-gray-300 mx-auto mb-4" />
          <h2 className="text-lg font-medium text-gray-600 mb-2">No articles yet</h2>
          <p className="text-sm text-gray-500 mb-4">
            Click &quot;Fetch New Articles&quot; to scrape the latest WSJ news
          </p>
        </div>
      ) : (
        <div className="grid gap-4">
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
