import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { MATERIAL_JOB_TYPE, toMaterialApiPackage } from "@/lib/materials/persistence";

interface Props {
  params: Promise<{ id: string }>;
}

export async function GET(_request: Request, { params }: Props) {
  const { id } = await params;

  const [article, trainingPackage, job] = await Promise.all([
    prisma.article.findUnique({ where: { id }, select: { id: true } }),
    prisma.trainingPackage.findUnique({ where: { articleId: id } }),
    prisma.materialJob.findUnique({
      where: {
        articleId_jobType: {
          articleId: id,
          jobType: MATERIAL_JOB_TYPE,
        },
      },
    }),
  ]);

  if (!article) {
    return NextResponse.json({ error: "Article not found" }, { status: 404 });
  }

  return NextResponse.json({
    articleId: id,
    trainingPackage: toMaterialApiPackage(trainingPackage),
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
