import Link from "next/link";
import { redirect } from "next/navigation";
import { isLocalDev } from "@/lib/auth/current-user";
import { AuthForm } from "@/components/auth-form";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export const dynamic = "force-dynamic";

export default async function LoginPage() {
  // Local-dev (no Supabase): there's no auth backend to query, and instantiating
  // the Supabase client with placeholder/empty keys throws. Just render the form
  // (the dev user is supplied by the protected layout, so /login stays reachable
  // for the offline E2E). Prod: query the real user + bounce if signed in.
  if (!isLocalDev()) {
    const { createClient } = await import("@/lib/supabase/server");
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (user) redirect("/dashboard");
  }

  return (
    <main className="flex min-h-svh flex-col items-center justify-center gap-7 px-6 py-12">
      {/* Brand identity — same pixel wordmark as the studio / app header. */}
      <Link href="/" className="flex items-center gap-2.5" aria-label="Agent Game Footage">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/ogf-logo-64.png" alt="" className="size-8 [image-rendering:pixelated]" aria-hidden />
        <span className="brand-title">
          <span className="brand-agent">Agent</span>
          <span className="brand-game">Game</span>
          <span className="brand-forge">Footage</span>
        </span>
      </Link>
      <Card className="w-full max-w-sm">
        <CardHeader className="text-center">
          <CardTitle className="text-xl">Welcome back</CardTitle>
          <CardDescription>Log in to your Footage account</CardDescription>
        </CardHeader>
        <CardContent>
          <AuthForm mode="login" />
          <p className="mt-5 text-center text-sm text-muted-foreground">
            Don&apos;t have an account?{" "}
            <Link href="/signup" className="font-medium text-foreground underline-offset-4 hover:underline">
              Sign up
            </Link>
          </p>
        </CardContent>
      </Card>
    </main>
  );
}
