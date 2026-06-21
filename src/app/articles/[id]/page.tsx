import { prisma } from "@/lib/db";
import { notFound } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, ExternalLink, Headphones } from "lucide-react";
import { TrainingPackPanel } from "@/components/TrainingPackPanel";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";

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
    <div className="container-page py-8 sm:py-10">
      <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_360px]">
        <div className="min-w-0">
          <div className="mb-8 border-b pb-6">
            <Link
              href="/"
              className="mb-5 inline-flex items-center gap-1.5 text-sm font-medium text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
            >
              <ArrowLeft className="size-4" aria-hidden="true" />
              Back to Articles
            </Link>

            <div className="mb-3 flex flex-wrap items-center gap-2">
              {article.category && (
                <Badge variant="outline">{article.category}</Badge>
              )}
              <span className="text-xs text-muted-foreground">
                {article.publishedAt.toLocaleDateString()}
              </span>
            </div>

            <h1 className="max-w-3xl text-balance text-3xl font-semibold leading-tight tracking-normal text-foreground sm:text-4xl">
              {article.title}
            </h1>

            <Link
              href={`/articles/${id}/shadow`}
              className={cn(buttonVariants({ size: "lg" }), "mt-6")}
            >
              <Headphones data-icon="inline-start" aria-hidden="true" />
              Start Shadow Reading
            </Link>
          </div>

          <article className="max-w-[72ch]">
            {paragraphs.map((paragraph, i) => (
              <p key={i} className="mb-5 text-base leading-8 text-foreground">
                {paragraph}
              </p>
            ))}
          </article>

          <Separator className="mt-8" />

          <div className="mt-4 flex min-w-0 items-center gap-2 text-xs text-muted-foreground">
            <ExternalLink className="size-3.5 shrink-0" aria-hidden="true" />
            <span className="shrink-0">Source:</span>
              <a
                href={article.url}
                target="_blank"
                rel="noopener noreferrer"
              className="truncate hover:text-foreground focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
              >
                {article.url}
              </a>
          </div>
        </div>

        <div className="h-fit lg:sticky lg:top-20">
          <TrainingPackPanel articleId={id} />
        </div>
      </div>
    </div>
  );
}
