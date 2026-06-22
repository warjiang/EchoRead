const DEFAULT_SESSION_COOKIE_NAME = "echoread_session";
const DEFAULT_SESSION_MAX_AGE_SECONDS = 30 * 24 * 60 * 60;

export function authSessionCookieName(): string {
  return process.env.AUTH_SESSION_COOKIE_NAME || DEFAULT_SESSION_COOKIE_NAME;
}

export function authSessionMaxAgeSeconds(): number {
  const parsed = Number(process.env.AUTH_SESSION_MAX_AGE_SECONDS);
  return Number.isFinite(parsed) && parsed > 0
    ? Math.trunc(parsed)
    : DEFAULT_SESSION_MAX_AGE_SECONDS;
}

export function normalizeEmail(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const email = value.trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : null;
}

export function adminEmailSet(): Set<string> {
  return new Set(
    (process.env.ADMIN_EMAILS || "")
      .split(/[,\s]+/)
      .map((email) => normalizeEmail(email))
      .filter((email): email is string => Boolean(email))
  );
}

export function isAdminEmail(email: string | null | undefined): boolean {
  if (!email) return false;
  return adminEmailSet().has(email);
}

