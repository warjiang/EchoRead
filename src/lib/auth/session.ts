import { createHash, randomBytes } from "crypto";
import { and, eq, gt } from "drizzle-orm";
import { cookies } from "next/headers";
import type { NextRequest, NextResponse } from "next/server";
import { createId, db, schema, touch } from "@/lib/db";
import { authSessionCookieName, authSessionMaxAgeSeconds, isAdminEmail } from "@/lib/auth/config";

export interface CurrentUser {
  id: string;
  email: string;
  canAdmin: boolean;
}

export function generateSessionToken(): string {
  return randomBytes(32).toString("base64url");
}

export function hashSessionToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function sessionExpiresAt(now = new Date()): Date {
  return new Date(now.getTime() + authSessionMaxAgeSeconds() * 1000);
}

export async function createAuthSession(userId: string): Promise<string> {
  const token = generateSessionToken();
  const now = touch();
  await db.insert(schema.authSessions).values({
    id: createId("session"),
    userId,
    tokenHash: hashSessionToken(token),
    expiresAt: sessionExpiresAt(now),
    createdAt: now,
    updatedAt: now,
  });
  return token;
}

export function setAuthCookie(response: NextResponse, token: string): void {
  response.cookies.set(authSessionCookieName(), token, authCookieOptions());
}

export function clearAuthCookie(response: NextResponse): void {
  response.cookies.delete(authSessionCookieName());
}

export async function setAuthCookieInStore(token: string): Promise<void> {
  const store = await cookies();
  store.set(authSessionCookieName(), token, authCookieOptions());
}

export async function clearAuthCookieInStore(): Promise<void> {
  const store = await cookies();
  store.delete(authSessionCookieName());
}

export function authCookieOptions() {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: authSessionMaxAgeSeconds(),
  };
}

export async function deleteSessionToken(token: string | null | undefined): Promise<void> {
  if (!token) return;
  await db
    .delete(schema.authSessions)
    .where(eq(schema.authSessions.tokenHash, hashSessionToken(token)));
}

export async function getCurrentUserFromToken(token: string | null | undefined): Promise<CurrentUser | null> {
  if (!token) return null;

  const [row] = await db
    .select({ user: schema.users })
    .from(schema.authSessions)
    .innerJoin(schema.users, eq(schema.authSessions.userId, schema.users.id))
    .where(
      and(
        eq(schema.authSessions.tokenHash, hashSessionToken(token)),
        gt(schema.authSessions.expiresAt, new Date())
      )
    )
    .limit(1);

  if (!row) return null;
  return {
    id: row.user.id,
    email: row.user.email,
    canAdmin: isAdminEmail(row.user.email),
  };
}

export async function getCurrentUser(): Promise<CurrentUser | null> {
  const store = await cookies();
  return getCurrentUserFromToken(store.get(authSessionCookieName())?.value);
}

export async function getCurrentUserFromRequest(request: NextRequest): Promise<CurrentUser | null> {
  return getCurrentUserFromToken(request.cookies.get(authSessionCookieName())?.value);
}

export async function requireCurrentUser(): Promise<CurrentUser> {
  const user = await getCurrentUser();
  if (!user) {
    throw new Error("Authentication required");
  }
  return user;
}

export async function requireAdminUser(): Promise<CurrentUser> {
  const user = await requireCurrentUser();
  if (!user.canAdmin) {
    throw new Error("Admin permission required");
  }
  return user;
}

