import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { MATERIAL_JOB_TYPE, toMaterialApiPackage } from "@/lib/materials/persistence";

interface Props {
  params: Promise<{ id: string }>;
}

export async function GET(_request: Request, { params }: Props) {
  const { id } = await params;

  const [article, trainingPackage, job] = await Promise.all([
    db.query.articles.findFirst({ where: eq(schema.articles.id, id), columns: { id: true } }),
    db.query.trainingPackages.findFirst({ where: eq(schema.trainingPackages.articleId, id) }),
    db.query.materialJobs.findFirst({
      where: and(eq(schema.materialJobs.articleId, id), eq(schema.materialJobs.jobType, MATERIAL_JOB_TYPE)),
    }),
  ]);

  if (!article) {
    return NextResponse.json({ error: "Article not found" }, { status: 404 });
  }

  return NextResponse.json({
    articleId: id,
    trainingPackage: toMaterialApiPackage(trainingPackage || null),
    job: job
      ? {
          status: job.status,
          attempts: job.attempts,
          maxAttempts: job.maxAttempts,
          runAfter: job.runAfter,
          lastError: job.lastError,
        }
      : null,
  });
}
