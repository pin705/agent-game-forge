import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Sparkles } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { BuildWorkspace } from "@/components/build-workspace";

export const dynamic = "force-dynamic";

/** True only when real (non-placeholder) Supabase env is present. */
function supabaseConfigured(): boolean {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  return Boolean(url && !url.includes("placeholder"));
}

export default async function BuildPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  let project: { name: string; slug: string } = { name: "Local project", slug: id };

  if (supabaseConfigured()) {
    const supabase = await createClient();
    // RLS ensures a user can only load their own project.
    const { data } = await supabase
      .from("projects")
      .select("id, name, slug, engine, r2_prefix")
      .eq("id", id)
      .maybeSingle();
    if (!data) notFound();
    project = { name: data.name, slug: data.slug };
  }

  return (
    <div className="flex h-[calc(100svh-3rem)] flex-col">
      {/* Builder sub-header */}
      <div className="flex items-center gap-3 border-b px-4 py-2">
        <Button asChild variant="ghost" size="sm">
          <Link href="/dashboard">
            <ArrowLeft />
            Dashboard
          </Link>
        </Button>
        <Separator orientation="vertical" className="h-5" />
        <div className="min-w-0">
          <p className="truncate text-sm font-medium">{project.name}</p>
          <p className="truncate text-xs text-muted-foreground">/{project.slug}</p>
        </div>
        <span className="ml-auto inline-flex items-center gap-1.5 rounded-full bg-muted px-2.5 py-1 text-xs text-muted-foreground">
          <Sparkles className="size-3.5" />
          Agent build · DeepSeek
        </span>
      </div>

      <BuildWorkspace projectId={id} />
    </div>
  );
}
