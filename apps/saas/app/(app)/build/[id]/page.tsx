import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Code2, MessageSquare, Monitor, Sparkles } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";

export const dynamic = "force-dynamic";

export default async function BuildPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();

  // RLS ensures a user can only load their own project.
  const { data: project } = await supabase
    .from("projects")
    .select("id, name, slug, engine, r2_prefix")
    .eq("id", id)
    .maybeSingle();

  if (!project) notFound();

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
          Agent build — coming in P1
        </span>
      </div>

      {/* 3-column editor shell: chat | preview | code */}
      <div className="grid flex-1 grid-cols-1 overflow-hidden md:grid-cols-[320px_1fr_360px]">
        {/* Left — chat placeholder */}
        <section className="flex flex-col overflow-hidden border-b md:border-b-0 md:border-r">
          <PaneHeader icon={<MessageSquare className="size-4" />} title="Chat" />
          <ScrollArea className="flex-1">
            <div className="flex h-full flex-col items-center justify-center gap-2 p-6 text-center">
              <Placeholder
                title="Describe changes to your game"
                body="The conversational build loop (DeepSeek agent) lands in P1. It will stream edits here."
              />
            </div>
          </ScrollArea>
          <div className="border-t p-3">
            <div className="flex items-center gap-2 rounded-md border border-input bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
              Message the agent… (disabled in P0)
            </div>
          </div>
        </section>

        {/* Center — preview placeholder */}
        <section className="flex flex-col overflow-hidden border-b md:border-b-0 md:border-r">
          <PaneHeader icon={<Monitor className="size-4" />} title="Preview" />
          <div className="flex flex-1 items-center justify-center bg-muted/30 p-6">
            <Placeholder
              title="Live game preview"
              body="Your generated game will run here once builds are wired up in P1."
            />
          </div>
        </section>

        {/* Right — code placeholder */}
        <section className="flex flex-col overflow-hidden">
          <PaneHeader icon={<Code2 className="size-4" />} title="Code" />
          <div className="flex flex-1 items-center justify-center p-6">
            <Placeholder
              title="Project files"
              body="The cloud file tree + editor (backed by R2) appears here in P1."
            />
          </div>
        </section>
      </div>
    </div>
  );
}

function PaneHeader({ icon, title }: { icon: React.ReactNode; title: string }) {
  return (
    <div className="flex items-center gap-2 border-b px-3 py-2 text-sm font-medium">
      <span className="text-muted-foreground">{icon}</span>
      {title}
    </div>
  );
}

function Placeholder({ title, body }: { title: string; body: string }) {
  return (
    <div className="max-w-[28ch]">
      <p className="text-sm font-medium">{title}</p>
      <p className="mt-1 text-xs text-muted-foreground">{body}</p>
    </div>
  );
}
