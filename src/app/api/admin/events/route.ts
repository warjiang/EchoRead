import { NextRequest, NextResponse } from "next/server";
import { isAdminRequest } from "@/lib/admin/auth";
import { listAdminEvents } from "@/lib/admin/service";

export async function GET(request: NextRequest) {
  if (!isAdminRequest(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  return NextResponse.json(
    await listAdminEvents({
      articleId: request.nextUrl.searchParams.get("articleId"),
      entityType: request.nextUrl.searchParams.get("entityType"),
      status: request.nextUrl.searchParams.get("status"),
      limit: request.nextUrl.searchParams.get("limit"),
    })
  );
}
