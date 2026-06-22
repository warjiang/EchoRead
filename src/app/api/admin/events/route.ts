import { NextRequest, NextResponse } from "next/server";
import { adminAuthErrorResponse, authorizeAdminRequest } from "@/lib/admin/auth";
import { listAdminEvents } from "@/lib/admin/service";

export async function GET(request: NextRequest) {
  const auth = await authorizeAdminRequest(request);
  if (!auth.ok) return adminAuthErrorResponse(auth);

  return NextResponse.json(
    await listAdminEvents({
      articleId: request.nextUrl.searchParams.get("articleId"),
      entityType: request.nextUrl.searchParams.get("entityType"),
      status: request.nextUrl.searchParams.get("status"),
      limit: request.nextUrl.searchParams.get("limit"),
    })
  );
}
