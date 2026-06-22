"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { authSessionCookieName } from "@/lib/auth/config";
import { safeRedirectPath } from "@/lib/auth/redirect";
import {
  createAuthSession,
  deleteSessionToken,
  setAuthCookieInStore,
  clearAuthCookieInStore,
} from "@/lib/auth/session";
import { authenticateUser, registerUser } from "@/lib/auth/users";

export interface AuthActionState {
  error?: string;
}

export async function loginAction(
  _previousState: AuthActionState | null,
  formData: FormData
): Promise<AuthActionState> {
  const result = await authenticateUser({
    email: formData.get("email"),
    password: formData.get("password"),
  });

  if (!result.ok || !result.userId) {
    return { error: result.error || "Invalid email or password." };
  }

  const token = await createAuthSession(result.userId);
  await setAuthCookieInStore(token);
  redirect(safeRedirectPath(formData.get("next")));
}

export async function registerAction(
  _previousState: AuthActionState | null,
  formData: FormData
): Promise<AuthActionState> {
  const result = await registerUser({
    email: formData.get("email"),
    password: formData.get("password"),
  });

  if (!result.ok || !result.userId) {
    return { error: result.error || "Failed to create account." };
  }

  const token = await createAuthSession(result.userId);
  await setAuthCookieInStore(token);
  redirect(safeRedirectPath(formData.get("next")));
}

export async function logoutAction() {
  const store = await cookies();
  await deleteSessionToken(store.get(authSessionCookieName())?.value);
  await clearAuthCookieInStore();
  redirect("/login");
}

