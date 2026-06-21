import { NextRequest, NextResponse } from "next/server";
import { isAdminRequest } from "@/lib/admin/auth";
import { isAdminJobType, markAdminJobFailed } from "@/lib/admin/service";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ type: string; id: string }> }
) {
  if (!isAdminRequest(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { type, id } = await params;
  if (!isAdminJobType(type)) {
    return NextResponse.json({ error: "Invalid job type" }, { status: 400 });
  }

  return NextResponse.json(await markAdminJobFailed(type, id));
}
