import { NextRequest, NextResponse } from "next/server";
import { adminAuthErrorResponse, authorizeAdminRequest } from "@/lib/admin/auth";
import { listAdminArticles } from "@/lib/admin/service";

export async function GET(request: NextRequest) {
  const auth = await authorizeAdminRequest(request);
  if (!auth.ok) return adminAuthErrorResponse(auth);

  return NextResponse.json(
    await listAdminArticles({
      query: request.nextUrl.searchParams.get("q"),
      limit: request.nextUrl.searchParams.get("limit"),
    })
  );
}
