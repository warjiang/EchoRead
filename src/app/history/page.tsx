import { prisma } from "@/lib/db";
import { BarChart3, Clock, BookOpen } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";

export default async function HistoryPage() {
  const history = await prisma.readingHistory.findMany({
    orderBy: { createdAt: "desc" },
    include: { article: true },
    take: 50,
  });

  const totalDuration = history.reduce((sum, h) => sum + h.duration, 0);
  const totalArticles = new Set(history.map((h) => h.articleId)).size;
  const shadowCompleted = history.filter((h) => h.shadowDone).length;

  return (
    <div className="container-page max-w-5xl py-8 sm:py-10">
      <div className="mb-8 flex flex-col gap-3 border-b pb-6">
        <Badge variant="outline" className="w-fit">
          Progress
        </Badge>
        <h1 className="text-3xl font-semibold leading-tight tracking-normal text-foreground">
          Learning History
        </h1>
        <p className="text-sm leading-6 text-muted-foreground">
          Track article sessions, practice time, and shadow reading completion.
        </p>
      </div>

      <div className="mb-8 grid gap-3 sm:grid-cols-3">
        <StatCard icon={BookOpen} label="Articles Read" value={totalArticles} />
        <StatCard
          icon={Clock}
          label="Minutes Practiced"
          value={Math.round(totalDuration / 60)}
        />
        <StatCard
          icon={BarChart3}
          label="Shadow Completed"
          value={shadowCompleted}
        />
      </div>

      {history.length === 0 ? (
        <Empty className="min-h-[320px] border">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <BarChart3 aria-hidden="true" />
            </EmptyMedia>
            <EmptyTitle>No Reading History Yet</EmptyTitle>
            <EmptyDescription>
              Start reading articles to track progress here.
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <div className="flex flex-col gap-2">
          {history.map((record) => (
            <Card key={record.id} size="sm">
              <CardContent className="flex items-start justify-between gap-4">
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-foreground">
                  {record.article.title}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {new Date(record.createdAt).toLocaleDateString()},{" "}
                  {Math.round(record.duration / 60)} min,{" "}
                  {Math.round(record.progress * 100)}% complete
                </p>
              </div>
              {record.shadowDone && (
                <Badge variant="secondary" className="shrink-0">
                  Shadow
                </Badge>
              )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

function StatCard({
  icon: Icon,
  label,
  value,
}: {
  icon: typeof BookOpen;
  label: string;
  value: number;
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
        <p className="font-mono text-3xl font-semibold tracking-normal">
          {value}
        </p>
      </CardContent>
    </Card>
  );
}
