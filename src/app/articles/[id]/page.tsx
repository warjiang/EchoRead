import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { notFound } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, ExternalLink, Headphones, RotateCcw } from "lucide-react";
import { retryOriginalArticleAudio } from "@/app/actions";
import { TrainingPackPanel } from "@/components/TrainingPackPanel";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { buttonVariants } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { serializeArticleAudio } from "@/lib/original-audio/queue";
import { cn } from "@/lib/utils";

interface Props {
  params: Promise<{ id: string }>;
}

export default async function ArticleDetailPage({ params }: Props) {
  const { id } = await params;

  const article = await db.query.articles.findFirst({
    where: eq(schema.articles.id, id),
  });

  if (!article) notFound();
  const [originalAudio, originalAudioJob] = await Promise.all([
    db.query.articleAudio.findFirst({ where: eq(schema.articleAudio.articleId, id) }),
    db.query.articleAudioJobs.findFirst({ where: eq(schema.articleAudioJobs.articleId, id) }),
  ]);

  const paragraphs = article.content.split("\n\n").filter(Boolean);
  const originalAudioState = serializeArticleAudio(originalAudio, originalAudioJob);
  const isShadowReady = originalAudioState.status === "ready";
  const retryAction = retryOriginalArticleAudio.bind(null, id);

  const audioStatusLabel: Record<string, string> = {
    pending: "Original audio pending",
    processing: "Original audio processing",
    ready: "Original audio ready",
    unavailable: "Original audio unavailable",
    failed: "Original audio failed",
  };

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

            <div className="mt-6 flex flex-col gap-3">
              <div className="flex flex-wrap items-center gap-3">
                {isShadowReady ? (
                  <Link
                    href={`/articles/${id}/shadow`}
                    className={cn(buttonVariants({ size: "lg" }))}
                  >
                    <Headphones data-icon="inline-start" aria-hidden="true" />
                    Start Shadow Reading
                  </Link>
                ) : (
                  <Button type="button" size="lg" disabled>
                    <Headphones data-icon="inline-start" aria-hidden="true" />
                    Start Shadow Reading
                  </Button>
                )}
                <Badge variant={isShadowReady ? "secondary" : "outline"}>
                  {audioStatusLabel[originalAudioState.status] || "Original audio pending"}
                </Badge>
              </div>

              <Alert variant={originalAudioState.status === "failed" ? "destructive" : "default"}>
                <AlertTitle>
                  {audioStatusLabel[originalAudioState.status] || "Original audio pending"}
                </AlertTitle>
                <AlertDescription>
                  {originalAudioState.status === "ready" &&
                    `${originalAudioState.clippedCount}/${originalAudioState.sentenceCount} sentences have WSJ clips.`}
                  {originalAudioState.status === "processing" &&
                    "The worker is downloading and cutting WSJ narration in the background."}
                  {originalAudioState.status === "pending" &&
                    "Original audio processing will start in the background."}
                  {originalAudioState.status === "unavailable" &&
                    (originalAudioState.lastError || "This article does not expose accessible WSJ narration.")}
                  {originalAudioState.status === "failed" &&
                    (originalAudioState.lastError || "Original audio processing failed.")}
                </AlertDescription>
              </Alert>

              {originalAudioState.status === "failed" && (
                <form action={retryAction} className="flex flex-wrap items-end gap-2">
                  <label className="flex flex-col gap-1 text-xs font-medium text-muted-foreground">
                    Retry timeout
                    <input
                      name="timeoutSeconds"
                      type="number"
                      min={30}
                      max={3600}
                      defaultValue={originalAudioState.job?.timeoutSeconds || 300}
                      className="h-8 w-32 rounded-md border bg-background px-2 text-sm text-foreground"
                    />
                  </label>
                  <Button type="submit" variant="secondary">
                    <RotateCcw data-icon="inline-start" aria-hidden="true" />
                    Retry Audio
                  </Button>
                </form>
              )}
            </div>
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
