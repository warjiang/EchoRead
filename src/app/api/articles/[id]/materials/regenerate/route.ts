import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { db, schema } from "@/lib/db";
import { isAuthorizedByBearer } from "@/lib/api-auth";
import { regenerateMaterialJob } from "@/lib/materials/queue";

interface Props {
  params: Promise<{ id: string }>;
}

export async function POST(request: NextRequest, { params }: Props) {
  if (!isAuthorizedByBearer(request, "MATERIAL_WORKER_SECRET")) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;

  const article = await db.query.articles.findFirst({ where: eq(schema.articles.id, id), columns: { id: true } });
  if (!article) {
    return NextResponse.json({ error: "Article not found" }, { status: 404 });
  }

  await regenerateMaterialJob(id);

  return NextResponse.json({
    message: "Regeneration job queued",
    articleId: id,
  });
}
