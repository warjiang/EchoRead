import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { LoginForm } from "@/app/login/LoginForm";
import { getCurrentUser } from "@/lib/auth/session";
import { safeRedirectPath } from "@/lib/auth/redirect";

export const metadata: Metadata = {
  title: "Sign In",
};

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const params = await searchParams;
  const next = safeRedirectPath(params.next);

  if (await getCurrentUser()) {
    redirect(next);
  }

  return (
    <div className="container-page flex min-h-[calc(100vh-3.5rem)] items-center justify-center py-10">
      <LoginForm next={next} />
    </div>
  );
}

