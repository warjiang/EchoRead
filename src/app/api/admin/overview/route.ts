import { NextRequest, NextResponse } from "next/server";
import { adminAuthErrorResponse, authorizeAdminRequest } from "@/lib/admin/auth";
import { getAdminOverview } from "@/lib/admin/service";

export async function GET(request: NextRequest) {
  const auth = await authorizeAdminRequest(request);
  if (!auth.ok) return adminAuthErrorResponse(auth);

  return NextResponse.json(await getAdminOverview());
}
