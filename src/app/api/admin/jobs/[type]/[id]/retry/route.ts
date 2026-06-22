import { NextRequest, NextResponse } from "next/server";
import { adminAuthErrorResponse, authorizeAdminRequest } from "@/lib/admin/auth";
import { isAdminJobType, retryAdminJob } from "@/lib/admin/service";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ type: string; id: string }> }
) {
  const auth = await authorizeAdminRequest(request);
  if (!auth.ok) return adminAuthErrorResponse(auth);

  const { type, id } = await params;
  if (!isAdminJobType(type)) {
    return NextResponse.json({ error: "Invalid job type" }, { status: 400 });
  }

  return NextResponse.json(await retryAdminJob(type, id));
}
