import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, FileText, Headphones, Trash2 } from "lucide-react";
import {
  deleteArticleAction,
  regenerateMaterialAction,
  resetOriginalAudioAction,
  retryOriginalAudioAction,
  updateArticleAction,
} from "@/app/admin/actions";
import { getAdminPageUser } from "@/lib/admin/auth";
import { getAdminArticle } from "@/lib/admin/service";
import { deserializeTrainingPayload } from "@/lib/materials/persistence";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

function fmtDate(value: Date | string | null | undefined) {
  if (!value) return "n/a";
  return new Date(value).toLocaleString();
}

function datetimeLocal(value: Date) {
  return value.toISOString().slice(0, 16);
}

function statusVariant(status: string): "default" | "secondary" | "destructive" | "outline" {
  if (status === "failed") return "destructive";
  if (status === "succeeded" || status === "ready") return "secondary";
  if (status === "pending") return "outline";
  return "default";
}

export const metadata: Metadata = {
  title: "Admin Article",
  robots: {
    index: false,
    follow: false,
  },
};

export default async function AdminArticlePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  await getAdminPageUser(`/admin/articles/${id}`);
  const article = await getAdminArticle(id);
  if (!article) {
    notFound();
  }

  const trainingPayload = article.trainingPackage?.payloadJson
    ? deserializeTrainingPayload(article.trainingPackage.payloadJson)
    : null;

  return (
    <div className="container-page max-w-7xl py-6 sm:py-8">
      <div className="mb-5 flex flex-col gap-4 border-b pb-5 lg:flex-row lg:items-end lg:justify-between">
        <div className="flex flex-col gap-2">
          <Button render={<Link href="/admin" />} nativeButton={false} variant="ghost" size="sm" className="w-fit">
            <ArrowLeft data-icon="inline-start" aria-hidden="true" />
            Admin
          </Button>
          <h1 className="max-w-4xl text-2xl font-semibold tracking-normal">{article.title}</h1>
          <div className="flex flex-wrap gap-2">
            <Badge variant={statusVariant(article.trainingPackage?.status || "pending")}>
              materials {article.trainingPackage?.status || "pending"}
            </Badge>
            <Badge variant={statusVariant(article.originalAudio?.status || "pending")}>
              audio {article.originalAudio?.status || "pending"}
            </Badge>
            <Badge variant="outline">{article.sentences.length} sentences</Badge>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <form action={regenerateMaterialAction}>
            <input type="hidden" name="articleId" value={article.id} />
            <Button type="submit" variant="outline">
              <FileText data-icon="inline-start" aria-hidden="true" />
              Regenerate Materials
            </Button>
          </form>
          <form action={retryOriginalAudioAction}>
            <input type="hidden" name="articleId" value={article.id} />
            <input type="hidden" name="timeoutSeconds" value="600" />
            <Button type="submit" variant="outline">
              <Headphones data-icon="inline-start" aria-hidden="true" />
              Retry Audio
            </Button>
          </form>
          <form action={resetOriginalAudioAction}>
            <input type="hidden" name="articleId" value={article.id} />
            <input type="hidden" name="timeoutSeconds" value="600" />
            <Button type="submit" variant="outline">
              <Headphones data-icon="inline-start" aria-hidden="true" />
              Reset Clips
            </Button>
          </form>
          <form action={deleteArticleAction}>
            <input type="hidden" name="id" value={article.id} />
            <Button type="submit" variant="destructive">
              <Trash2 data-icon="inline-start" aria-hidden="true" />
              Delete Article
            </Button>
          </form>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_360px]">
        <div className="flex flex-col gap-4">
          <Card>
            <CardHeader>
              <CardTitle>Edit Article</CardTitle>
            </CardHeader>
            <CardContent>
              <form action={updateArticleAction.bind(null, article.id)} className="grid gap-3">
                <label className="grid gap-1.5 text-sm font-medium">
                  Title
                  <input name="title" defaultValue={article.title} className="h-9 rounded-md border bg-background px-3 text-sm" />
                </label>
                <div className="grid gap-3 sm:grid-cols-2">
                  <label className="grid gap-1.5 text-sm font-medium">
                    Category
                    <input name="category" defaultValue={article.category || ""} className="h-9 rounded-md border bg-background px-3 text-sm" />
                  </label>
                  <label className="grid gap-1.5 text-sm font-medium">
                    Published
                    <input name="publishedAt" type="datetime-local" defaultValue={datetimeLocal(article.publishedAt)} className="h-9 rounded-md border bg-background px-3 text-sm" />
                  </label>
                </div>
                <label className="grid gap-1.5 text-sm font-medium">
                  Content
                  <textarea name="content" defaultValue={article.content} rows={14} className="min-h-72 rounded-md border bg-background p-3 text-sm leading-6" />
                </label>
                <div className="flex justify-end">
                  <Button type="submit">Save Article</Button>
                </div>
              </form>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Sentence Audio Alignment</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto rounded-lg border">
                <table className="w-full min-w-[920px] text-left text-sm">
                    <thead className="border-b bg-muted/50 text-xs text-muted-foreground">
                      <tr>
                        <th className="px-3 py-2 font-medium">#</th>
                        <th className="px-3 py-2 font-medium">Status</th>
                        <th className="px-3 py-2 font-medium">Timing</th>
                        <th className="px-3 py-2 font-medium">Clip</th>
                        <th className="px-3 py-2 font-medium">Sentence</th>
                      </tr>
                    </thead>
                  <tbody>
                    {article.sentences.map((sentence) => (
                      <tr key={sentence.id} className="border-b last:border-b-0">
                        <td className="px-3 py-2 font-mono text-xs">{sentence.index + 1}</td>
                          <td className="px-3 py-2">
                            <Badge variant={statusVariant(sentence.wsjAudioStatus)}>{sentence.wsjAudioStatus}</Badge>
                          </td>
                          <td className="px-3 py-2 font-mono text-xs text-muted-foreground">
                            {sentence.wsjAudioStartMs ?? "n/a"}-{sentence.wsjAudioEndMs ?? "n/a"} ms
                          </td>
                          <td className="px-3 py-2">
                            {sentence.wsjAudioUrl ? (
                              <audio src={sentence.wsjAudioUrl} controls preload="none" className="h-8 w-40" />
                            ) : (
                              <span className="text-xs text-muted-foreground">n/a</span>
                            )}
                          </td>
                          <td className="px-3 py-2">{sentence.text}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        </div>

        <div className="flex flex-col gap-4">
          <Card size="sm">
            <CardHeader>
              <CardTitle>Status</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-2 text-sm">
              <Info label="Article ID" value={article.id} />
              <Info label="URL" value={article.url} />
              <Info label="Created" value={fmtDate(article.createdAt)} />
              <Info label="Material Error" value={article.trainingPackage?.errorMessage || "n/a"} />
              <Info label="Audio Error" value={article.originalAudio?.lastError || article.originalAudioJob?.lastError || "n/a"} />
              <Info label="Source URL" value={article.originalAudio?.sourceAudioUrl || "n/a"} />
              <Info label="Source Path" value={article.originalAudio?.sourcePath || "n/a"} />
              <Info label="Coverage" value={article.originalAudio?.coverageRatio != null ? `${Math.round(article.originalAudio.coverageRatio * 100)}%` : "n/a"} />
              {article.originalAudio?.sourceAudioUrl && (
                <audio src={article.originalAudio.sourceAudioUrl} controls preload="none" className="h-9 w-full" />
              )}
            </CardContent>
          </Card>

          <Card size="sm">
            <CardHeader>
              <CardTitle>Training Package</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-2 text-sm">
              <Info label="Model" value={article.trainingPackage?.model || "n/a"} />
              <Info label="Prompt" value={article.trainingPackage?.promptVersion || "n/a"} />
              <Info label="Sections" value={trainingPayload ? Object.keys(trainingPayload).length : 0} />
              {trainingPayload && (
                <pre className="max-h-72 overflow-auto rounded-md bg-muted p-3 text-xs leading-5">
                  {JSON.stringify(trainingPayload, null, 2)}
                </pre>
              )}
            </CardContent>
          </Card>

          <Card size="sm">
            <CardHeader>
              <CardTitle>Pipeline Events</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-2">
              {article.pipelineEvents.map((event) => (
                <div key={event.id} className="rounded-md border p-2 text-sm">
                  <div className="flex items-center justify-between gap-2">
                    <Badge variant={statusVariant(event.status)}>{event.scope}:{event.status}</Badge>
                    <span className="font-mono text-xs text-muted-foreground">{fmtDate(event.createdAt)}</span>
                  </div>
                  <p className="mt-2">{event.message}</p>
                  {event.errorMessage && (
                    <pre className="mt-1 whitespace-pre-wrap break-words text-xs text-destructive">{event.errorMessage}</pre>
                  )}
                </div>
              ))}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}

function Info({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="grid gap-1 border-b pb-2 last:border-b-0 last:pb-0">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className="whitespace-pre-wrap break-words font-mono text-xs">{value}</span>
    </div>
  );
}
