import { NextRequest, NextResponse } from "next/server";
import { isAuthorizedByBearer } from "@/lib/api-auth";
import { processMaterialJobs } from "@/lib/materials/queue";

export async function POST(request: NextRequest) {
  if (!isAuthorizedByBearer(request, "MATERIAL_WORKER_SECRET")) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const rawLimit = Number(searchParams.get("limit") || "2");
  const limit = Number.isFinite(rawLimit) ? Math.min(Math.max(rawLimit, 1), 10) : 2;

  const result = await processMaterialJobs(limit);
  return NextResponse.json(result);
}
