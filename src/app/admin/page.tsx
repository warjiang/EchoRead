import type { Metadata } from "next";
import Link from "next/link";
import {
  Activity,
  CircleX,
  Database,
  FileText,
  Headphones,
  Play,
  RefreshCw,
  RotateCcw,
  Server,
  Trash2,
} from "lucide-react";
import {
  deleteArticleAction,
  failJobAction,
  logoutAdmin,
  queueScrapeAction,
  regenerateMaterialAction,
  resetJobAction,
  retryFailedJobsAction,
  retryJobAction,
  retryOriginalAudioAction,
  runWorkerOnceAction,
} from "@/app/admin/actions";
import { getAdminPageUser } from "@/lib/admin/auth";
import { getAdminOverview, listAdminArticles, listAdminEvents, listAdminJobs } from "@/lib/admin/service";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";

export const metadata: Metadata = {
  title: "Pipeline Admin",
  robots: {
    index: false,
    follow: false,
  },
};

function fmtDate(value: Date | string | null | undefined) {
  if (!value) return "n/a";
  return new Date(value).toLocaleString();
}

function pct(done: number, total: number) {
  if (total <= 0) return "0%";
  return `${Math.round((done / total) * 100)}%`;
}

function statusVariant(status: string): "default" | "secondary" | "destructive" | "outline" {
  if (status === "failed") return "destructive";
  if (status === "succeeded" || status === "ready") return "secondary";
  if (status === "pending") return "outline";
  return "default";
}

export default async function AdminPage({
  searchParams,
}: {
  searchParams: Promise<{ type?: string; status?: string; q?: string }>;
}) {
  await getAdminPageUser("/admin");
  const params = await searchParams;
  const [overview, jobs, articles, events] = await Promise.all([
    getAdminOverview(),
    listAdminJobs({ type: params.type, status: params.status, limit: 50 }),
    listAdminArticles({ query: params.q, limit: 50 }),
    listAdminEvents({ limit: 30 }),
  ]);

  const latestHeartbeat = overview.workerHeartbeats[0];

  return (
    <div className="container-page max-w-7xl py-6 sm:py-8">
      <div className="mb-6 flex flex-col gap-4 border-b pb-5 lg:flex-row lg:items-end lg:justify-between">
        <div className="flex flex-col gap-2">
          <Badge variant="outline" className="w-fit">
            Operations
          </Badge>
          <h1 className="text-3xl font-semibold tracking-normal">Pipeline Admin</h1>
          <p className="max-w-2xl text-sm leading-6 text-muted-foreground">
            Manage WSJ collection, generated materials, original audio, and recovery actions.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <form action={queueScrapeAction} className="flex gap-2">
            <input
              name="maxArticles"
              type="number"
              min="1"
              max="10"
              defaultValue="5"
              className="h-8 w-20 rounded-md border bg-background px-2 text-sm"
              aria-label="Max articles"
            />
            <Button type="submit">
              <RefreshCw data-icon="inline-start" aria-hidden="true" />
              Queue Scrape
            </Button>
          </form>
          <form action={runWorkerOnceAction}>
            <Button type="submit" variant="outline">
              <Play data-icon="inline-start" aria-hidden="true" />
              Run Once
            </Button>
          </form>
          <form action={retryFailedJobsAction}>
            <Button type="submit" variant="outline">
              <RotateCcw data-icon="inline-start" aria-hidden="true" />
              Retry Failed
            </Button>
          </form>
          <form action={logoutAdmin}>
            <Button type="submit" variant="ghost">
              Sign Out
            </Button>
          </form>
        </div>
      </div>

      <div className="mb-6 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <Metric icon={Server} label="Worker" value={overview.workerOnline ? "Online" : "Offline"} detail={latestHeartbeat ? fmtDate(latestHeartbeat.lastSeenAt) : "No heartbeat"} />
        <Metric icon={Database} label="Articles" value={overview.articleCount} detail={`${overview.todayScrapes} scrape jobs today`} />
        <Metric icon={FileText} label="Materials" value={pct(overview.completion.materials.succeeded, overview.completion.materials.total)} detail={`${overview.completion.materials.succeeded}/${overview.completion.materials.total} ready`} />
        <Metric icon={Headphones} label="Original Audio" value={pct(overview.completion.audio.ready, overview.completion.audio.total)} detail={`${overview.completion.audio.ready}/${overview.completion.audio.total} ready`} />
      </div>

      <div className="mb-6 grid gap-3 lg:grid-cols-3">
        <QueueCard title="Scrape" data={overview.queues.scrape} />
        <QueueCard title="Materials" data={overview.queues.material} />
        <QueueCard title="Original Audio" data={overview.queues.audio} />
      </div>

      <section className="mb-8">
        <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h2 className="text-lg font-semibold tracking-normal">Jobs</h2>
            <p className="text-sm text-muted-foreground">Retry failed work, reset stale locks, and inspect queue errors.</p>
          </div>
          <div className="flex flex-wrap gap-1">
            {["all", "scrape", "material", "audio"].map((type) => (
              <Button key={type} render={<Link href={type === "all" ? "/admin" : `/admin?type=${type}`} />} nativeButton={false} variant={params.type === type || (!params.type && type === "all") ? "secondary" : "ghost"} size="sm">
                {type}
              </Button>
            ))}
          </div>
        </div>
        <div className="overflow-x-auto rounded-lg border">
          <table className="w-full min-w-[860px] text-left text-sm">
            <thead className="border-b bg-muted/50 text-xs text-muted-foreground">
              <tr>
                <th className="px-3 py-2 font-medium">Type</th>
                <th className="px-3 py-2 font-medium">Status</th>
                <th className="px-3 py-2 font-medium">Article</th>
                <th className="px-3 py-2 font-medium">Attempts</th>
                <th className="px-3 py-2 font-medium">Updated</th>
                <th className="px-3 py-2 font-medium">Error</th>
                <th className="px-3 py-2 text-right font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {jobs.map((job) => (
                <tr key={`${job.type}-${job.id}`} className="border-b last:border-b-0">
                  <td className="px-3 py-2 font-mono text-xs">{job.type}</td>
                  <td className="px-3 py-2">
                    <Badge variant={statusVariant(job.status)}>{job.status}</Badge>
                  </td>
                  <td className="max-w-[240px] truncate px-3 py-2">
                    {job.articleId ? (
                      <Link href={`/admin/articles/${job.articleId}`} className="hover:underline">
                        {job.articleTitle || job.articleId}
                      </Link>
                    ) : (
                      <span className="text-muted-foreground">collection</span>
                    )}
                  </td>
                  <td className="px-3 py-2 font-mono text-xs">
                    {job.attempts}/{job.maxAttempts}
                  </td>
                  <td className="px-3 py-2 text-xs text-muted-foreground">{fmtDate(job.updatedAt)}</td>
                  <td className="max-w-[240px] truncate px-3 py-2 text-xs text-muted-foreground" title={job.lastError || undefined}>{job.lastError || "n/a"}</td>
                  <td className="px-3 py-2">
                    <div className="flex justify-end gap-1">
                        <form action={retryJobAction}>
                          <input type="hidden" name="type" value={job.type} />
                          <input type="hidden" name="id" value={job.id} />
                          <Button type="submit" size="icon-sm" variant="ghost" aria-label="Retry job" disabled={!job.canRetry}>
                            <RefreshCw aria-hidden="true" />
                          </Button>
                        </form>
                        <form action={resetJobAction}>
                          <input type="hidden" name="type" value={job.type} />
                          <input type="hidden" name="id" value={job.id} />
                          <Button type="submit" size="icon-sm" variant="ghost" aria-label="Reset job" disabled={!job.canReset}>
                            <RotateCcw aria-hidden="true" />
                          </Button>
                        </form>
                        <form action={failJobAction}>
                          <input type="hidden" name="type" value={job.type} />
                          <input type="hidden" name="id" value={job.id} />
                          <Button type="submit" size="icon-sm" variant="destructive" aria-label="Mark job failed" disabled={!job.canMarkFailed}>
                            <CircleX aria-hidden="true" />
                          </Button>
                        </form>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="mb-8">
        <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h2 className="text-lg font-semibold tracking-normal">Articles</h2>
            <p className="text-sm text-muted-foreground">Edit content, regenerate materials, retry audio, or delete derived assets.</p>
          </div>
          <form className="flex gap-2">
            <input name="q" defaultValue={params.q || ""} className="h-8 w-56 rounded-md border bg-background px-2 text-sm" placeholder="Search articles" />
            <Button type="submit" variant="outline" size="sm">Search</Button>
          </form>
        </div>
        {articles.length === 0 ? (
          <Empty className="min-h-[240px] border">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <Database aria-hidden="true" />
              </EmptyMedia>
              <EmptyTitle>No Articles</EmptyTitle>
              <EmptyDescription>Queue a scrape job to populate the management table.</EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : (
          <div className="overflow-x-auto rounded-lg border">
            <table className="w-full min-w-[920px] text-left text-sm">
              <thead className="border-b bg-muted/50 text-xs text-muted-foreground">
                <tr>
                  <th className="px-3 py-2 font-medium">Title</th>
                  <th className="px-3 py-2 font-medium">Category</th>
                  <th className="px-3 py-2 font-medium">Sentences</th>
                  <th className="px-3 py-2 font-medium">Materials</th>
                  <th className="px-3 py-2 font-medium">Audio</th>
                  <th className="px-3 py-2 font-medium">Created</th>
                  <th className="px-3 py-2 text-right font-medium">Actions</th>
                </tr>
              </thead>
              <tbody>
                {articles.map((article) => (
                  <tr key={article.id} className="border-b last:border-b-0">
                    <td className="max-w-[320px] truncate px-3 py-2 font-medium">
                      <Link href={`/admin/articles/${article.id}`} className="hover:underline">
                        {article.title}
                      </Link>
                    </td>
                    <td className="px-3 py-2 text-muted-foreground">{article.category || "n/a"}</td>
                    <td className="px-3 py-2 font-mono text-xs">{article._count.sentences}</td>
                    <td className="px-3 py-2">
                      <Badge variant={statusVariant(article.trainingPackage?.status || "pending")}>
                        {article.trainingPackage?.status || "pending"}
                      </Badge>
                    </td>
                    <td className="px-3 py-2">
                      <Badge variant={statusVariant(article.originalAudio?.status || "pending")}>
                        {article.originalAudio?.status || "pending"}
                      </Badge>
                    </td>
                    <td className="px-3 py-2 text-xs text-muted-foreground">{fmtDate(article.createdAt)}</td>
                    <td className="px-3 py-2">
                      <div className="flex justify-end gap-1">
                        <form action={regenerateMaterialAction}>
                          <input type="hidden" name="articleId" value={article.id} />
                          <Button type="submit" size="icon-sm" variant="ghost" aria-label="Regenerate materials">
                            <FileText aria-hidden="true" />
                          </Button>
                        </form>
                        <form action={retryOriginalAudioAction}>
                          <input type="hidden" name="articleId" value={article.id} />
                          <Button type="submit" size="icon-sm" variant="ghost" aria-label="Retry audio">
                            <Headphones aria-hidden="true" />
                          </Button>
                        </form>
                        <form action={deleteArticleAction}>
                          <input type="hidden" name="id" value={article.id} />
                          <Button type="submit" size="icon-sm" variant="destructive" aria-label="Delete article">
                            <Trash2 aria-hidden="true" />
                          </Button>
                        </form>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section>
        <div className="mb-3">
          <h2 className="text-lg font-semibold tracking-normal">Events</h2>
          <p className="text-sm text-muted-foreground">Recent scrape, material, audio, and manual operations.</p>
        </div>
        <div className="rounded-lg border">
          {events.map((event) => (
            <div key={event.id} className="grid gap-2 border-b px-3 py-2 text-sm last:border-b-0 sm:grid-cols-[160px_120px_1fr_160px]">
              <span className="font-mono text-xs text-muted-foreground">{fmtDate(event.createdAt)}</span>
              <Badge variant={statusVariant(event.status)}>{event.scope}:{event.status}</Badge>
              <span className="min-w-0 truncate">{event.message}</span>
              <span className="truncate text-xs text-muted-foreground">{event.errorMessage || event.articleId || event.jobId || event.entityId || ""}</span>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

function Metric({
  icon: Icon,
  label,
  value,
  detail,
}: {
  icon: typeof Activity;
  label: string;
  value: string | number;
  detail: string;
}) {
  return (
    <Card size="sm">
      <CardHeader>
        <div className="flex items-center justify-between gap-3">
          <CardTitle className="text-sm">{label}</CardTitle>
          <span className="flex size-8 items-center justify-center rounded-md bg-muted text-muted-foreground">
            <Icon className="size-4" aria-hidden="true" />
          </span>
        </div>
      </CardHeader>
      <CardContent>
        <p className="font-mono text-2xl font-semibold tracking-normal">{value}</p>
        <p className="mt-1 truncate text-xs text-muted-foreground">{detail}</p>
      </CardContent>
    </Card>
  );
}

function QueueCard({
  title,
  data,
}: {
  title: string;
  data: { pending: number; running: number; failed: number };
}) {
  return (
    <Card size="sm">
      <CardHeader>
        <CardTitle className="text-sm">{title}</CardTitle>
      </CardHeader>
      <CardContent className="grid grid-cols-3 gap-2">
        <QueueCount label="Pending" value={data.pending} />
        <QueueCount label="Running" value={data.running} />
        <QueueCount label="Failed" value={data.failed} />
      </CardContent>
    </Card>
  );
}

function QueueCount({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <p className="font-mono text-xl font-semibold tracking-normal">{value}</p>
      <p className="text-xs text-muted-foreground">{label}</p>
    </div>
  );
}
