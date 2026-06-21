"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import {
  adminCookieName,
  adminSessionMaxAgeSeconds,
  createAdminSessionToken,
  hasAdminSession,
  isAdminEnabled,
  verifyAdminSecret,
} from "@/lib/admin/auth";
import {
  deleteAdminArticle,
  isAdminJobType,
  markAdminJobFailed,
  queueAdminScrape,
  regenerateAdminMaterial,
  resetAdminOriginalAudio,
  resetAdminJob,
  retryAdminJob,
  retryFailedAdminJobs,
  retryAdminOriginalAudio,
  updateAdminArticle,
} from "@/lib/admin/service";
import { recordPipelineEvent } from "@/lib/admin/pipeline";
import { processMaterialJobs } from "@/lib/materials/queue";
import { processArticleAudioJobs } from "@/lib/original-audio/queue";
import { processScrapeJobs } from "@/lib/scraper/worker";

async function requireAdmin() {
  if (!(await hasAdminSession())) {
    redirect("/admin/login");
  }
}

export async function loginAdmin(_previousState: { error?: string } | null, formData: FormData) {
  if (!isAdminEnabled()) {
    return { error: "Admin is not enabled. Set ADMIN_SECRET in production." };
  }

  if (!verifyAdminSecret(formData.get("secret"))) {
    return { error: "Invalid admin secret" };
  }

  const store = await cookies();
  store.set(adminCookieName(), createAdminSessionToken(), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: adminSessionMaxAgeSeconds(),
  });
  redirect("/admin");
}

export async function logoutAdmin() {
  const store = await cookies();
  store.delete(adminCookieName());
  redirect("/admin/login");
}

export async function queueScrapeAction(formData: FormData) {
  await requireAdmin();
  await queueAdminScrape(formData.get("maxArticles") || 5);
  revalidatePath("/admin");
}

export async function runWorkerOnceAction() {
  await requireAdmin();
  const scrape = await processScrapeJobs(1);
  const materials = await processMaterialJobs(2);
  const audio = await processArticleAudioJobs(2);
  await recordPipelineEvent({
    scope: "manual",
    entityType: "worker",
    status: "succeeded",
    message: "Admin ran one worker pass",
    metadata: { scrape, materials, audio },
  });
  revalidatePath("/admin");
}

export async function retryFailedJobsAction() {
  await requireAdmin();
  await retryFailedAdminJobs();
  revalidatePath("/admin");
}

export async function retryJobAction(formData: FormData) {
  await requireAdmin();
  const type = formData.get("type");
  if (isAdminJobType(type)) {
    await retryAdminJob(type, String(formData.get("id") || ""));
  }
  revalidatePath("/admin");
}

export async function resetJobAction(formData: FormData) {
  await requireAdmin();
  const type = formData.get("type");
  if (isAdminJobType(type)) {
    await resetAdminJob(type, String(formData.get("id") || ""));
  }
  revalidatePath("/admin");
}

export async function failJobAction(formData: FormData) {
  await requireAdmin();
  const type = formData.get("type");
  if (isAdminJobType(type)) {
    await markAdminJobFailed(type, String(formData.get("id") || ""));
  }
  revalidatePath("/admin");
}

export async function updateArticleAction(articleId: string, formData: FormData) {
  await requireAdmin();
  await updateAdminArticle(articleId, {
    title: formData.get("title"),
    category: formData.get("category"),
    publishedAt: formData.get("publishedAt"),
    content: formData.get("content"),
  });
  revalidatePath("/admin");
  revalidatePath(`/admin/articles/${articleId}`);
}

export async function deleteArticleAction(formData: FormData) {
  await requireAdmin();
  await deleteAdminArticle(String(formData.get("id") || ""));
  revalidatePath("/admin");
  redirect("/admin");
}

export async function regenerateMaterialAction(formData: FormData) {
  await requireAdmin();
  const articleId = String(formData.get("articleId") || "");
  await regenerateAdminMaterial(articleId);
  revalidatePath("/admin");
  revalidatePath(`/admin/articles/${articleId}`);
}

export async function retryOriginalAudioAction(formData: FormData) {
  await requireAdmin();
  const articleId = String(formData.get("articleId") || "");
  await retryAdminOriginalAudio(articleId, formData.get("timeoutSeconds"));
  revalidatePath("/admin");
  revalidatePath(`/admin/articles/${articleId}`);
}

export async function resetOriginalAudioAction(formData: FormData) {
  await requireAdmin();
  const articleId = String(formData.get("articleId") || "");
  await resetAdminOriginalAudio(articleId, formData.get("timeoutSeconds"));
  revalidatePath("/admin");
  revalidatePath(`/admin/articles/${articleId}`);
}
