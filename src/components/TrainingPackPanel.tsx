"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { regenerateTrainingPack } from "@/app/actions";
import type { TrainingMaterialPayload } from "@/lib/materials/types";

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

export function TrainingPackPanel({ articleId }: Props) {
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
    return <div className="rounded-xl border border-gray-200 bg-white p-4 text-sm text-gray-500">Loading training pack...</div>;
  }

  return (
    <aside className="rounded-xl border border-gray-200 bg-white p-4 space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-base font-semibold text-gray-900">Training Pack</h2>
        <span className="text-xs px-2 py-1 rounded bg-gray-100 text-gray-700">{statusText(data)}</span>
      </div>

      <p className="text-xs text-gray-500">Model-ready shadow reading materials generated from this article.</p>

      {data?.trainingPackage?.errorMessage && (
        <p className="text-xs text-red-600">{data.trainingPackage.errorMessage}</p>
      )}
      {data?.job?.lastError && <p className="text-xs text-red-600">Job: {data.job.lastError}</p>}
      {error && <p className="text-xs text-red-600">{error}</p>}

      <button
        onClick={regenerate}
        disabled={actionLoading}
        className="w-full rounded-lg bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
      >
        {actionLoading ? "Queueing..." : "Regenerate Training Pack"}
      </button>

      {!payload && <p className="text-sm text-gray-500">No package yet. Trigger regeneration to start.</p>}

      {payload && (
        <div className="space-y-4">
          {summary && (
            <div className="grid grid-cols-2 gap-2 text-xs text-gray-600">
              <p>Chunked: {summary.chunked}</p>
              <p>Dictation: {summary.dictation}</p>
              <p>Cloze: {summary.cloze}</p>
              <p>Retell: {summary.retell}</p>
              <p>Keywords: {summary.keywords}</p>
              <p>Version: {data?.trainingPackage?.version ?? 1}</p>
            </div>
          )}

          <section>
            <h3 className="text-sm font-semibold text-gray-900 mb-2">Chunked Script</h3>
            <ul className="space-y-2 text-xs text-gray-700 max-h-48 overflow-auto">
              {payload.chunkedScript.slice(0, 8).map((item, index) => (
                <li key={`${index}-${item.sentence.slice(0, 20)}`} className="rounded border border-gray-100 p-2">
                  <p className="font-medium">{item.sentence}</p>
                  <p className="mt-1 text-gray-600">{item.chunks.join(" / ")}</p>
                  <p className="mt-1 text-gray-500">Stress: {item.stressWords.join(", ")}</p>
                </li>
              ))}
            </ul>
          </section>

          <section>
            <h3 className="text-sm font-semibold text-gray-900 mb-2">Simplified Version (B1-B2)</h3>
            <p className="text-xs text-gray-700 leading-5">{payload.simplifiedVersion.text}</p>
          </section>

          <section>
            <h3 className="text-sm font-semibold text-gray-900 mb-2">Dictation</h3>
            <ul className="space-y-1 text-xs text-gray-700 list-disc list-inside">
              {payload.dictationExercises.slice(0, 5).map((item, index) => (
                <li key={`${index}-${item.prompt.slice(0, 20)}`}>{item.prompt}</li>
              ))}
            </ul>
          </section>

          <section>
            <h3 className="text-sm font-semibold text-gray-900 mb-2">Cloze</h3>
            <ul className="space-y-1 text-xs text-gray-700 list-disc list-inside">
              {payload.clozeExercises.slice(0, 5).map((item, index) => (
                <li key={`${index}-${item.prompt.slice(0, 20)}`}>{item.prompt}</li>
              ))}
            </ul>
          </section>

          <section>
            <h3 className="text-sm font-semibold text-gray-900 mb-2">Retell Outline</h3>
            <ul className="space-y-1 text-xs text-gray-700 list-disc list-inside">
              {payload.retellOutline.slice(0, 6).map((item, index) => (
                <li key={`${index}-${item.point.slice(0, 20)}`}>{item.point}</li>
              ))}
            </ul>
          </section>

          <section>
            <h3 className="text-sm font-semibold text-gray-900 mb-2">Keyword Prompts</h3>
            <ul className="space-y-1 text-xs text-gray-700 list-disc list-inside">
              {payload.keywordPrompts.slice(0, 8).map((item, index) => (
                <li key={`${index}-${item.keyword}`}>{item.keyword}: {item.prompt}</li>
              ))}
            </ul>
          </section>
        </div>
      )}
    </aside>
  );
}
