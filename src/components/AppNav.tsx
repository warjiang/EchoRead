import { AppNavClient } from "@/components/AppNavClient";
import { getCurrentUser } from "@/lib/auth/session";

export async function AppNav() {
  const user = await getCurrentUser();
  return <AppNavClient user={user} />;
}
