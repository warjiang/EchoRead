import { NextRequest, NextResponse } from "next/server";
import { adminAuthErrorResponse, authorizeAdminRequest } from "@/lib/admin/auth";
import { regenerateAdminMaterial } from "@/lib/admin/service";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await authorizeAdminRequest(request);
  if (!auth.ok) return adminAuthErrorResponse(auth);

  const { id } = await params;
  await regenerateAdminMaterial(id);
  return NextResponse.json({ ok: true });
}
