import test from "node:test";
import assert from "node:assert/strict";
import {
  adminCookieName,
  adminSessionMaxAgeSeconds,
  createAdminSessionToken,
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

test("validates admin secret and session token", () => {
  withEnv({ ADMIN_SECRET: "secret", NODE_ENV: "production" }, () => {
    assert.equal(isAdminEnabled(), true);
    assert.equal(verifyAdminSecret("secret"), true);
    assert.equal(verifyAdminSecret("wrong"), false);
    assert.equal(verifyAdminSessionToken(createAdminSessionToken()), true);
    assert.equal(verifyAdminSessionToken("wrong"), false);
  });
});

test("disables production admin when ADMIN_SECRET is missing", () => {
  withEnv({ ADMIN_SECRET: undefined, NODE_ENV: "production" }, () => {
    assert.equal(isAdminEnabled(), false);
    assert.equal(verifyAdminSecret(""), false);
  });
});

test("uses admin cookie defaults and clamps invalid max age", () => {
  withEnv(
    {
      ADMIN_SESSION_COOKIE_NAME: undefined,
      ADMIN_SESSION_MAX_AGE_SECONDS: "-1",
    },
    () => {
      assert.equal(adminCookieName(), "echoread_admin");
      assert.equal(adminSessionMaxAgeSeconds(), 86400);
    }
  );
});
