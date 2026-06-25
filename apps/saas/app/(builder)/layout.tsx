import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth/current-user";
import { AppChrome } from "@/components/app-chrome";

// Protected routes are always per-request (auth + user data).
export const dynamic = "force-dynamic";

/**
 * Builder route group layout (editor surface). Does the SAME auth as the
 * `(app)` layout — `getSessionUser()` → redirect to /login when null — and wraps
 * children in <AppChrome> so the ⌘K command palette + settings dialog + theme
 * still work. It renders NO <TopNav>: the build page provides its own SINGLE
 * compact header that folds in the global chrome (credits/⌘K/account/settings/
 * sign-out) + the project chrome (back-to-dashboard/name/remix/publish). This is
 * what reclaims a full header's worth of vertical space for the editor.
 */
export default async function BuilderLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const user = await getSessionUser();
  if (!user) redirect("/login");

  const email = user.email ?? null;

  return <AppChrome email={email}>{children}</AppChrome>;
}
