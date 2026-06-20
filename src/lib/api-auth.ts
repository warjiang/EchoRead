import type { NextRequest } from "next/server";

export function isAuthorizedByBearer(request: NextRequest, secretEnvName: string): boolean {
  const secret = process.env[secretEnvName];
  if (!secret) {
    return process.env.NODE_ENV !== "production";
  }

  const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  return token === secret;
}
