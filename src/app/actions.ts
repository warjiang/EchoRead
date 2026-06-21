"use server";

import { revalidatePath } from "next/cache";

function appBaseUrl(): string {
  return process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
}

export async function triggerScrape() {
  const headers: Record<string, string> = {};
  const secret = process.env.SCRAPER_WORKER_SECRET;
  if (secret) {
    headers.Authorization = `Bearer ${secret}`;
  }

  const response = await fetch(`${appBaseUrl()}/api/scraper`, {
    method: "POST",
    headers,
    cache: "no-store",
  });

  if (!response.ok) {
    const data = (await response.json().catch(() => null)) as { error?: string } | null;
    throw new Error(data?.error || "Failed to create article scrape job");
  }

  revalidatePath("/");
}

export async function regenerateTrainingPack(articleId: string) {
  const headers: Record<string, string> = {};
  const secret = process.env.MATERIAL_WORKER_SECRET;
  if (secret) {
    headers.Authorization = `Bearer ${secret}`;
  }

  const response = await fetch(`${appBaseUrl()}/api/articles/${articleId}/materials/regenerate`, {
    method: "POST",
    headers,
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error("Failed to queue regeneration");
  }

  revalidatePath(`/articles/${articleId}`);
}

export async function generateArticleAudio(articleId: string) {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  const secret = process.env.MATERIAL_WORKER_SECRET;
  if (secret) {
    headers.Authorization = `Bearer ${secret}`;
  }

  const response = await fetch(`${appBaseUrl()}/api/tts`, {
    method: "PUT",
    headers,
    body: JSON.stringify({ articleId }),
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error("Failed to generate article audio");
  }

  revalidatePath(`/articles/${articleId}/shadow`);
}

export async function retryOriginalArticleAudio(articleId: string, formData: FormData) {
  const timeoutSeconds = Number(formData.get("timeoutSeconds") || 300);
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  const secret = process.env.SCRAPER_WORKER_SECRET;
  if (secret) {
    headers.Authorization = `Bearer ${secret}`;
  }

  const response = await fetch(`${appBaseUrl()}/api/articles/${articleId}/original-audio/retry`, {
    method: "POST",
    headers,
    body: JSON.stringify({ timeoutSeconds }),
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error("Failed to retry original audio processing");
  }

  revalidatePath(`/articles/${articleId}`);
  revalidatePath(`/articles/${articleId}/shadow`);
}
