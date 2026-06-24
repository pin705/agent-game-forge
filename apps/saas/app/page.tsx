import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { Button } from "@/components/ui/button";

// Auth state is per-request — never statically prerender this route.
export const dynamic = "force-dynamic";

export default async function Home() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (user) redirect("/dashboard");

  return (
    <main className="flex min-h-svh flex-col items-center justify-center px-6">
      <div className="mx-auto max-w-xl text-center">
        <p className="mb-3 text-xs font-medium uppercase tracking-widest text-muted-foreground">
          Footage
        </p>
        <h1 className="text-balance text-4xl font-semibold tracking-tight sm:text-5xl">
          Build games with AI.
        </h1>
        <p className="mx-auto mt-4 max-w-md text-balance text-muted-foreground">
          Describe a game in plain language and watch it come together in the
          cloud. Lovable, but for games.
        </p>
        <div className="mt-8 flex items-center justify-center gap-3">
          <Button asChild size="lg">
            <Link href="/login">Log in</Link>
          </Button>
          <Button asChild size="lg" variant="outline">
            <Link href="/signup">Sign up free</Link>
          </Button>
        </div>
        <p className="mt-6 text-xs text-muted-foreground">
          50 free credits on signup. No card required.
        </p>
      </div>
    </main>
  );
}
