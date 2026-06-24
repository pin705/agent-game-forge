import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { TopNav } from "@/components/top-nav";

// Protected routes are always per-request (auth + user data).
export const dynamic = "force-dynamic";

export default async function AppLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // Middleware already guards these routes; this is defense-in-depth.
  if (!user) redirect("/login");

  // Best-effort credits read (table may not exist until the migration runs).
  let credits: number | null = null;
  const { data: profile } = await supabase
    .from("profiles")
    .select("credits_balance")
    .eq("id", user.id)
    .maybeSingle();
  if (profile) credits = profile.credits_balance as number;

  return (
    <div className="flex min-h-svh flex-col">
      <TopNav email={user.email ?? "account"} credits={credits} />
      <div className="flex-1">{children}</div>
    </div>
  );
}
