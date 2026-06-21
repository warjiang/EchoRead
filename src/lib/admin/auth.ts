import { createHmac, timingSafeEqual } from "crypto";
import { cookies } from "next/headers";
import type { NextRequest } from "next/server";

const DEFAULT_COOKIE_NAME = "echoread_admin";
const DEFAULT_MAX_AGE_SECONDS = 24 * 60 * 60;

function adminSecret(): string | null {
  const secret = process.env.ADMIN_SECRET;
  return secret && secret.length > 0 ? secret : null;
}

export function adminCookieName(): string {
  return process.env.ADMIN_SESSION_COOKIE_NAME || DEFAULT_COOKIE_NAME;
}

export function adminSessionMaxAgeSeconds(): number {
  const parsed = Number(process.env.ADMIN_SESSION_MAX_AGE_SECONDS);
  return Number.isFinite(parsed) && parsed > 0
    ? Math.trunc(parsed)
    : DEFAULT_MAX_AGE_SECONDS;
}

export function isAdminEnabled(): boolean {
  return Boolean(adminSecret()) || process.env.NODE_ENV !== "production";
}

export function createAdminSessionToken(secret = adminSecret() || "development-admin"): string {
  return createHmac("sha256", secret).update("echoread-admin-session").digest("hex");
}

export function verifyAdminSecret(value: unknown): boolean {
  const expected = adminSecret();
  if (!expected) {
    return process.env.NODE_ENV !== "production";
  }
  if (typeof value !== "string") {
    return false;
  }

  const actualBuffer = Buffer.from(value);
  const expectedBuffer = Buffer.from(expected);
  return (
    actualBuffer.length === expectedBuffer.length &&
    timingSafeEqual(actualBuffer, expectedBuffer)
  );
}

export function verifyAdminSessionToken(value: unknown): boolean {
  if (!isAdminEnabled() || typeof value !== "string") {
    return false;
  }

  const expected = createAdminSessionToken();
  const actualBuffer = Buffer.from(value);
  const expectedBuffer = Buffer.from(expected);
  return (
    actualBuffer.length === expectedBuffer.length &&
    timingSafeEqual(actualBuffer, expectedBuffer)
  );
}

export async function hasAdminSession(): Promise<boolean> {
  const store = await cookies();
  return verifyAdminSessionToken(store.get(adminCookieName())?.value);
}

export function isAdminRequest(request: NextRequest): boolean {
  return verifyAdminSessionToken(request.cookies.get(adminCookieName())?.value);
}
