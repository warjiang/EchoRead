import { NextRequest, NextResponse } from "next/server";
import {
  adminCookieName,
  adminSessionMaxAgeSeconds,
  createAdminSessionToken,
  isAdminEnabled,
  verifyAdminSecret,
} from "@/lib/admin/auth";

export async function POST(request: NextRequest) {
  if (!isAdminEnabled()) {
    return NextResponse.json({ error: "Admin is not enabled" }, { status: 503 });
  }

  const body = (await request.json().catch(() => ({}))) as { secret?: unknown };
  if (!verifyAdminSecret(body.secret)) {
    return NextResponse.json({ error: "Invalid admin secret" }, { status: 401 });
  }

  const response = NextResponse.json({ ok: true });
  response.cookies.set(adminCookieName(), createAdminSessionToken(), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: adminSessionMaxAgeSeconds(),
  });
  return response;
}
