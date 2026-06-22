import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { RegisterForm } from "@/app/register/RegisterForm";
import { safeRedirectPath } from "@/lib/auth/redirect";
import { getCurrentUser } from "@/lib/auth/session";

export const metadata: Metadata = {
  title: "Create Account",
};

export default async function RegisterPage({
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
      <RegisterForm next={next} />
    </div>
  );
}

