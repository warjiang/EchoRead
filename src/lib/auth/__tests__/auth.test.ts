import test from "node:test";
import assert from "node:assert/strict";
import { adminEmailSet, authSessionCookieName, authSessionMaxAgeSeconds, isAdminEmail, normalizeEmail } from "@/lib/auth/config";
import { hashPassword, isValidPassword, verifyPassword } from "@/lib/auth/password";
import { safeRedirectPath } from "@/lib/auth/redirect";
import { hashSessionToken, sessionExpiresAt } from "@/lib/auth/session";

function withEnv(env: Record<string, string | undefined>, run: () => void) {
  const previous = Object.fromEntries(
    Object.keys(env).map((key) => [key, process.env[key]])
  );
  for (const [key, value] of Object.entries(env)) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
  try {
    run();
  } finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }
}

test("normalizes email and derives admin allowlist", () => {
  withEnv({ ADMIN_EMAILS: "Admin@Example.com, ops@example.com invalid" }, () => {
    assert.equal(normalizeEmail(" Admin@Example.com "), "admin@example.com");
    assert.equal(normalizeEmail("missing-at"), null);
    assert.deepEqual([...adminEmailSet()].sort(), ["admin@example.com", "ops@example.com"]);
    assert.equal(isAdminEmail("admin@example.com"), true);
    assert.equal(isAdminEmail("user@example.com"), false);
  });
});

test("uses session cookie defaults and validates max age", () => {
  withEnv(
    {
      AUTH_SESSION_COOKIE_NAME: undefined,
      AUTH_SESSION_MAX_AGE_SECONDS: "-1",
    },
    () => {
      assert.equal(authSessionCookieName(), "echoread_session");
      assert.equal(authSessionMaxAgeSeconds(), 30 * 24 * 60 * 60);
    }
  );
});

test("hashes and verifies passwords with scrypt", async () => {
  assert.equal(isValidPassword("1234567"), false);
  assert.equal(isValidPassword("12345678"), true);
  const stored = await hashPassword("correct horse battery staple");
  assert.equal(stored.startsWith("scrypt$"), true);
  assert.equal(await verifyPassword("correct horse battery staple", stored), true);
  assert.equal(await verifyPassword("wrong password", stored), false);
});

test("hashes session tokens without exposing raw token", () => {
  const hash = hashSessionToken("raw-token");
  assert.notEqual(hash, "raw-token");
  assert.equal(hash.length, 64);
  assert.equal(hashSessionToken("raw-token"), hash);
});

test("calculates session expiry from configured max age", () => {
  withEnv({ AUTH_SESSION_MAX_AGE_SECONDS: "60" }, () => {
    assert.equal(
      sessionExpiresAt(new Date("2026-06-22T00:00:00.000Z")).toISOString(),
      "2026-06-22T00:01:00.000Z"
    );
  });
});

test("allows only site-local redirect paths", () => {
  assert.equal(safeRedirectPath("/admin?tab=jobs"), "/admin?tab=jobs");
  assert.equal(safeRedirectPath("https://evil.example"), "/");
  assert.equal(safeRedirectPath("//evil.example"), "/");
  assert.equal(safeRedirectPath("/\\evil"), "/");
  assert.equal(safeRedirectPath(null, "/articles"), "/articles");
});

