import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { AdminLoginForm } from "@/app/admin/login/AdminLoginForm";
import { hasAdminSession, isAdminEnabled } from "@/lib/admin/auth";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";

export const metadata: Metadata = {
  title: "Admin Login",
  robots: {
    index: false,
    follow: false,
  },
};

export default async function AdminLoginPage() {
  if (await hasAdminSession()) {
    redirect("/admin");
  }

  return (
    <div className="container-page flex min-h-[calc(100vh-3.5rem)] items-center justify-center py-10">
      <div className="flex w-full max-w-sm flex-col gap-4">
        {!isAdminEnabled() && (
          <Alert variant="destructive">
            <AlertTitle>Admin Disabled</AlertTitle>
            <AlertDescription>
              Set ADMIN_SECRET to enable the management console in production.
            </AlertDescription>
          </Alert>
        )}
        <AdminLoginForm />
      </div>
    </div>
  );
}
