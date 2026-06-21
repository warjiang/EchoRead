import { NextRequest, NextResponse } from "next/server";
import { isAdminRequest } from "@/lib/admin/auth";
import { listAdminArticles } from "@/lib/admin/service";

export async function GET(request: NextRequest) {
  if (!isAdminRequest(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  return NextResponse.json(
    await listAdminArticles({
      query: request.nextUrl.searchParams.get("q"),
      limit: request.nextUrl.searchParams.get("limit"),
    })
  );
}
