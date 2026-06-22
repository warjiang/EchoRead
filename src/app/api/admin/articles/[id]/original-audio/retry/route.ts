import { NextRequest, NextResponse } from "next/server";
import { adminAuthErrorResponse, authorizeAdminRequest } from "@/lib/admin/auth";
import { retryAdminOriginalAudio } from "@/lib/admin/service";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await authorizeAdminRequest(request);
  if (!auth.ok) return adminAuthErrorResponse(auth);

  const { id } = await params;
  const body = (await request.json().catch(() => ({}))) as { timeoutSeconds?: unknown };
  await retryAdminOriginalAudio(id, body.timeoutSeconds);
  return NextResponse.json({ ok: true });
}
