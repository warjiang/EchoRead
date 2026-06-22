import { redirect } from "next/navigation";
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { authSessionCookieName, authSessionMaxAgeSeconds } from "@/lib/auth/config";
import {
  getCurrentUser,
  getCurrentUserFromRequest,
  type CurrentUser,
} from "@/lib/auth/session";

export type AdminRequestAuth =
  | { ok: true; user: CurrentUser }
  | { ok: false; status: 401 | 403 };

export function adminCookieName(): string {
  return authSessionCookieName();
}

export function adminSessionMaxAgeSeconds(): number {
  return authSessionMaxAgeSeconds();
}

export function isAdminEnabled(): boolean {
  return true;
}

export function createAdminSessionToken(): string {
  throw new Error("Admin sessions use the global auth session token.");
}

export function verifyAdminSecret(): boolean {
  return false;
}

export function verifyAdminSessionToken(): boolean {
  return false;
}

export async function getAdminPageUser(next = "/admin"): Promise<CurrentUser> {
  const user = await getCurrentUser();
  if (!user) {
    redirect(`/login?next=${encodeURIComponent(next)}`);
  }
  if (!user.canAdmin) {
    redirect("/");
  }
  return user;
}

export async function hasAdminSession(): Promise<boolean> {
  const user = await getCurrentUser();
  return Boolean(user?.canAdmin);
}

export async function authorizeAdminRequest(request: NextRequest): Promise<AdminRequestAuth> {
  const user = await getCurrentUserFromRequest(request);
  if (!user) return { ok: false, status: 401 };
  if (!user.canAdmin) return { ok: false, status: 403 };
  return { ok: true, user };
}

export async function isAdminRequest(request: NextRequest): Promise<boolean> {
  return (await authorizeAdminRequest(request)).ok;
}

export function adminAuthErrorResponse(auth: Extract<AdminRequestAuth, { ok: false }>) {
  return NextResponse.json(
    { error: auth.status === 401 ? "Unauthorized" : "Forbidden" },
    { status: auth.status }
  );
}
