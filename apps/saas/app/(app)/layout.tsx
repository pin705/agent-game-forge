import { redirect } from "next/navigation";
import { getSessionUser, isLocalDev } from "@/lib/auth/current-user";
import { DEV_CREDITS } from "@/lib/billing/credits";
import { TopNav } from "@/components/top-nav";
import { AppChrome } from "@/components/app-chrome";

// Protected routes are always per-request (auth + user data).
export const dynamic = "force-dynamic";

export default async function AppLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  // getSessionUser() resolves the real Supabase user in prod, or the stable dev
  // user in local-dev (no Supabase). Middleware already guards prod; this is
  // defense-in-depth there and the single auth source in local-dev.
  const user = await getSessionUser();
  if (!user) redirect("/login");

  // Credits: prod reads the user's cached profile balance; local-dev shows the
  // standing free-credit balance so the chip + credit gate are exercisable.
  let credits: number | null = isLocalDev() ? DEV_CREDITS : null;
  if (!isLocalDev()) {
    const { createClient } = await import("@/lib/supabase/server");
    const supabase = await createClient();
    const { data: profile } = await supabase
      .from("profiles")
      .select("credits_balance")
      .eq("id", user.id)
      .maybeSingle();
    if (profile) credits = profile.credits_balance as number;
  }

  const email = user.email ?? null;

  return (
    <AppChrome email={email}>
      <div className="flex min-h-svh flex-col">
        <TopNav email={email ?? "account"} credits={credits} />
        <div className="flex-1">{children}</div>
      </div>
    </AppChrome>
  );
}
