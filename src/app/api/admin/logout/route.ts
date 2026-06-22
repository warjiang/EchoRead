import { NextRequest, NextResponse } from "next/server";
import { authSessionCookieName } from "@/lib/auth/config";
import { clearAuthCookie, deleteSessionToken } from "@/lib/auth/session";

export async function POST(request: NextRequest) {
  await deleteSessionToken(request.cookies.get(authSessionCookieName())?.value);
  const response = NextResponse.json({ ok: true });
  clearAuthCookie(response);
  return response;
}
