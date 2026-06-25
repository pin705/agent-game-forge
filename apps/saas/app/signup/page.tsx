import Link from "next/link";
import { redirect } from "next/navigation";
import { isLocalDev } from "@/lib/auth/current-user";
import { AuthForm } from "@/components/auth-form";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export const dynamic = "force-dynamic";

export default async function SignupPage() {
  // Local-dev (no Supabase): render the form without touching Supabase (empty
  // keys would throw). Prod: query the real user + bounce if already signed in.
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
          <CardTitle className="text-xl">Create your account</CardTitle>
          <CardDescription>Start with 50 free credits — no card required</CardDescription>
        </CardHeader>
        <CardContent>
          <AuthForm mode="signup" />
          <p className="mt-5 text-center text-sm text-muted-foreground">
            Already have an account?{" "}
            <Link href="/login" className="font-medium text-foreground underline-offset-4 hover:underline">
              Log in
            </Link>
          </p>
        </CardContent>
      </Card>
    </main>
  );
}
