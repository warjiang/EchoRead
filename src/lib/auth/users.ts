import { eq } from "drizzle-orm";
import { createId, db, schema, touch } from "@/lib/db";
import { normalizeEmail } from "@/lib/auth/config";
import { hashPassword, isValidPassword, verifyPassword } from "@/lib/auth/password";

export interface AuthResult {
  ok: boolean;
  userId?: string;
  error?: string;
}

export async function registerUser(input: { email: unknown; password: unknown }): Promise<AuthResult> {
  const email = normalizeEmail(input.email);
  if (!email) return { ok: false, error: "Enter a valid email address." };
  if (!isValidPassword(input.password)) {
    return { ok: false, error: "Password must be at least 8 characters." };
  }

  const existing = await db.query.users.findFirst({
    where: eq(schema.users.email, email),
    columns: { id: true },
  });
  if (existing) return { ok: false, error: "An account with this email already exists." };

  const now = touch();
  const [user] = await db
    .insert(schema.users)
    .values({
      id: createId("user"),
      email,
      passwordHash: await hashPassword(input.password),
      createdAt: now,
      updatedAt: now,
    })
    .returning({ id: schema.users.id });

  return { ok: true, userId: user.id };
}

export async function authenticateUser(input: { email: unknown; password: unknown }): Promise<AuthResult> {
  const email = normalizeEmail(input.email);
  if (!email || typeof input.password !== "string") {
    return { ok: false, error: "Invalid email or password." };
  }

  const user = await db.query.users.findFirst({
    where: eq(schema.users.email, email),
  });

  if (!user || !(await verifyPassword(input.password, user.passwordHash))) {
    return { ok: false, error: "Invalid email or password." };
  }

  return { ok: true, userId: user.id };
}

