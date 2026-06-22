import test from "node:test";
import assert from "node:assert/strict";
import {
  adminCookieName,
  adminSessionMaxAgeSeconds,
  isAdminEnabled,
  verifyAdminSecret,
  verifyAdminSessionToken,
} from "@/lib/admin/auth";

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

test("admin secret helpers are disabled after moving to user auth", () => {
  withEnv({ ADMIN_EMAILS: "admin@example.com", NODE_ENV: "production" }, () => {
    assert.equal(isAdminEnabled(), true);
    assert.equal(verifyAdminSecret(), false);
    assert.equal(verifyAdminSessionToken(), false);
  });
});

test("admin compatibility cookie helpers delegate to global auth config", () => {
  withEnv(
    {
      AUTH_SESSION_COOKIE_NAME: undefined,
      AUTH_SESSION_MAX_AGE_SECONDS: "-1",
    },
    () => {
      assert.equal(adminCookieName(), "echoread_session");
      assert.equal(adminSessionMaxAgeSeconds(), 30 * 24 * 60 * 60);
    }
  );
});
