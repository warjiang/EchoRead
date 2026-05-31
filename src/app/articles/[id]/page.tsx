import { prisma } from "@/lib/db";
import { notFound } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, Headphones } from "lucide-react";

interface Props {
  params: Promise<{ id: string }>;
}

export default async function ArticleDetailPage({ params }: Props) {
  const { id } = await params;

  const article = await prisma.article.findUnique({
    where: { id },
    include: {
      sentences: { orderBy: { index: "asc" } },
    },
  });

  if (!article) notFound();

  const paragraphs = article.content.split("\n\n").filter(Boolean);

  return (
    <div className="max-w-3xl mx-auto px-4 py-8">
      <div className="mb-6">
        <Link href="/" className="flex items-center gap-1 text-sm text-gray-500 hover:text-blue-600 mb-4">
          <ArrowLeft className="w-4 h-4" />
          Back to Articles
        </Link>

        <div className="flex items-center gap-2 mb-2">
          {article.category && (
            <span className="text-xs font-medium text-blue-600 bg-blue-50 px-2 py-0.5 rounded">
              {article.category}
            </span>
          )}
          <span className="text-xs text-gray-500">
            {article.publishedAt.toLocaleDateString()}
          </span>
        </div>

        <h1 className="text-2xl font-bold text-gray-900 mb-4">{article.title}</h1>

        <Link
          href={`/articles/${id}/shadow`}
          className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 text-sm"
        >
          <Headphones className="w-4 h-4" />
          Start Shadow Reading
        </Link>
      </div>

      <article className="prose prose-gray max-w-none">
        {paragraphs.map((paragraph, i) => (
          <p key={i} className="text-gray-800 leading-relaxed mb-4">
            {paragraph}
          </p>
        ))}
      </article>

      <div className="mt-8 pt-4 border-t">
        <p className="text-xs text-gray-400">
          Source: <a href={article.url} target="_blank" rel="noopener noreferrer" className="hover:text-blue-600">{article.url}</a>
        </p>
      </div>
    </div>
  );
}
