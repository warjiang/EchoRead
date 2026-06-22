"use client";

import type * as React from "react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { regenerateTrainingPack } from "@/app/actions";
import type { TrainingMaterialPayload } from "@/lib/materials/types";
import { AlertCircle, RefreshCw, Sparkles } from "lucide-react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

interface MaterialResponse {
  articleId: string;
  trainingPackage: {
    status: "pending" | "running" | "succeeded" | "failed";
    payload: TrainingMaterialPayload | null;
    errorMessage: string | null;
    updatedAt: string;
    version: number;
    model: string | null;
  } | null;
  job: {
    status: "pending" | "running" | "succeeded" | "failed";
    attempts: number;
    maxAttempts: number;
    runAfter: string;
    lastError: string | null;
  } | null;
}

interface Props {
  articleId: string;
  canAdmin?: boolean;
}

function statusText(data: MaterialResponse | null): string {
  if (!data?.trainingPackage) return "Not generated";
  switch (data.trainingPackage.status) {
    case "pending":
      return "Queued";
    case "running":
      return "Generating";
    case "failed":
      return "Failed";
    case "succeeded":
      return "Ready";
    default:
      return "Unknown";
  }
}

function statusVariant(
  data: MaterialResponse | null
): React.ComponentProps<typeof Badge>["variant"] {
  switch (data?.trainingPackage?.status) {
    case "failed":
      return "destructive";
    case "succeeded":
      return "default";
    case "pending":
    case "running":
      return "secondary";
    default:
      return "outline";
  }
}

export function TrainingPackPanel({ articleId, canAdmin = false }: Props) {
  const [data, setData] = useState<MaterialResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    const response = await fetch(`/api/articles/${articleId}/materials`, { cache: "no-store" });
    if (!response.ok) {
      throw new Error("Failed to load training package");
    }
    const nextData = (await response.json()) as MaterialResponse;
    setData(nextData);
  }, [articleId]);

  useEffect(() => {
    let cancelled = false;

    async function run() {
      try {
        await fetchData();
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : "Failed to load");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    run();

    return () => {
      cancelled = true;
    };
  }, [fetchData]);

  const activeStatus = data?.trainingPackage?.status;
  const shouldPoll = activeStatus === "pending" || activeStatus === "running";

  useEffect(() => {
    if (!shouldPoll) return;

    const timer = window.setInterval(() => {
      fetchData().catch(() => undefined);
    }, 5000);

    return () => window.clearInterval(timer);
  }, [fetchData, shouldPoll]);

  const regenerate = async () => {
    setActionLoading(true);
    setError(null);
    try {
      await regenerateTrainingPack(articleId);
      await fetchData();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to regenerate");
    } finally {
      setActionLoading(false);
    }
  };

  const payload = data?.trainingPackage?.payload;
  const summary = useMemo(() => {
    if (!payload) return null;
    return {
      chunked: payload.chunkedScript.length,
      dictation: payload.dictationExercises.length,
      cloze: payload.clozeExercises.length,
      retell: payload.retellOutline.length,
      keywords: payload.keywordPrompts.length,
    };
  }, [payload]);

  if (loading) {
    return (
      <Card>
        <CardHeader>
          <Skeleton className="h-5 w-36" />
          <Skeleton className="h-4 w-56" />
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <Skeleton className="h-8 w-full" />
          <Skeleton className="h-24 w-full" />
        </CardContent>
      </Card>
    );
  }

  return (
    <aside>
      <Card className="gap-4">
        <CardHeader>
          <div className="flex items-start justify-between gap-3">
            <div className="flex min-w-0 flex-col gap-1">
              <CardTitle>Training Pack</CardTitle>
              <p className="text-sm leading-6 text-muted-foreground">
                Shadow reading drills generated from this article.
              </p>
            </div>
            <Badge variant={statusVariant(data)}>{statusText(data)}</Badge>
          </div>
        </CardHeader>

        <CardContent className="flex flex-col gap-4">
          {(data?.trainingPackage?.errorMessage ||
            data?.job?.lastError ||
            error) && (
            <Alert variant="destructive">
              <AlertCircle aria-hidden="true" />
              <AlertTitle>Generation issue</AlertTitle>
              <AlertDescription>
                {data?.trainingPackage?.errorMessage ||
                  data?.job?.lastError ||
                  error}
              </AlertDescription>
            </Alert>
          )}

          {canAdmin && (
            <Button
              type="button"
              onClick={regenerate}
              disabled={actionLoading}
              className="w-full"
            >
              <RefreshCw data-icon="inline-start" aria-hidden="true" />
              {actionLoading ? "Queueing…" : "Regenerate Training Pack"}
            </Button>
          )}

          {!payload && (
            <div className="rounded-lg border border-dashed p-4 text-sm leading-6 text-muted-foreground">
              No package yet.
            </div>
          )}

          {payload && (
            <div className="flex flex-col gap-4">
              {summary && (
                <div className="grid grid-cols-2 gap-2 text-xs">
                  {[
                    ["Chunked", summary.chunked],
                    ["Dictation", summary.dictation],
                    ["Cloze", summary.cloze],
                    ["Retell", summary.retell],
                    ["Keywords", summary.keywords],
                    ["Version", data?.trainingPackage?.version ?? 1],
                  ].map(([label, value]) => (
                    <div
                      key={label}
                      className="rounded-md bg-muted px-2.5 py-2"
                    >
                      <p className="text-muted-foreground">{label}</p>
                      <p className="font-mono text-sm text-foreground">
                        {value}
                      </p>
                    </div>
                  ))}
                </div>
              )}

              <Tabs defaultValue="script">
                <TabsList className="grid w-full grid-cols-3">
                  <TabsTrigger value="script">Script</TabsTrigger>
                  <TabsTrigger value="simplify">B1-B2</TabsTrigger>
                  <TabsTrigger value="drills">Drills</TabsTrigger>
                </TabsList>

                <TabsContent value="script" className="pt-2">
                  <ScrollArea className="h-72 rounded-lg border">
                    <div className="flex flex-col gap-2 p-3">
                      {payload.chunkedScript.slice(0, 8).map((item, index) => (
                        <div
                          key={`${index}-${item.sentence.slice(0, 20)}`}
                          className="rounded-md border p-3 text-xs leading-5"
                        >
                          <p className="font-medium text-foreground">
                            {item.sentence}
                          </p>
                          <p className="mt-2 text-muted-foreground">
                            {item.chunks.join(" / ")}
                          </p>
                          <p className="mt-2 font-mono text-muted-foreground">
                            Stress: {item.stressWords.join(", ")}
                          </p>
                        </div>
                      ))}
                    </div>
                  </ScrollArea>
                </TabsContent>

                <TabsContent value="simplify" className="pt-2">
                  <div className="rounded-lg border p-3 text-sm leading-6 text-muted-foreground">
                    {payload.simplifiedVersion.text}
                  </div>
                </TabsContent>

                <TabsContent value="drills" className="pt-2">
                  <ScrollArea className="h-72 rounded-lg border">
                    <div className="flex flex-col gap-4 p-3">
                      <DrillList
                        title="Dictation"
                        items={payload.dictationExercises
                          .slice(0, 5)
                          .map((item) => item.prompt)}
                      />
                      <Separator />
                      <DrillList
                        title="Cloze"
                        items={payload.clozeExercises
                          .slice(0, 5)
                          .map((item) => item.prompt)}
                      />
                      <Separator />
                      <DrillList
                        title="Retell Outline"
                        items={payload.retellOutline
                          .slice(0, 6)
                          .map((item) => item.point)}
                      />
                      <Separator />
                      <DrillList
                        title="Keyword Prompts"
                        items={payload.keywordPrompts
                          .slice(0, 8)
                          .map((item) => `${item.keyword}: ${item.prompt}`)}
                      />
                    </div>
                  </ScrollArea>
                </TabsContent>
              </Tabs>

              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <Sparkles className="size-3.5" aria-hidden="true" />
                <span>
                  Materials update automatically while generation is running.
                </span>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </aside>
  );
}

function DrillList({ title, items }: { title: string; items: string[] }) {
  return (
    <section className="flex flex-col gap-2">
      <h3 className="text-sm font-medium text-foreground">{title}</h3>
      <ul className="flex flex-col gap-1.5 text-xs leading-5 text-muted-foreground">
        {items.map((item, index) => (
          <li
            key={`${title}-${index}-${item.slice(0, 16)}`}
            className="flex gap-2"
          >
            <span className="font-mono text-[11px] text-muted-foreground">
              {String(index + 1).padStart(2, "0")}
            </span>
            <span>{item}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
