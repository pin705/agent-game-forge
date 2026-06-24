"use client";

import { useCallback, useEffect, useState } from "react";
import { Code2, FileText, MessageSquare, Monitor, RefreshCw } from "lucide-react";
import { BuildChat } from "@/components/build-chat";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";

/** Client shell for the 3-pane builder: chat (left) · preview (center) · files (right). */
export function BuildWorkspace({ projectId }: { projectId: string }) {
  const [files, setFiles] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/projects/${projectId}/files`);
      if (res.ok) {
        const data = await res.json();
        setFiles(data.files ?? []);
      }
    } catch {
      /* ignore */
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const hasGame = files.includes("index.html");

  return (
    <div className="grid flex-1 grid-cols-1 overflow-hidden md:grid-cols-[340px_1fr_320px]">
      {/* Left — chat */}
      <section className="flex flex-col overflow-hidden border-b md:border-b-0 md:border-r">
        <PaneHeader icon={<MessageSquare className="size-4" />} title="Chat" />
        <div className="min-h-0 flex-1">
          <BuildChat projectId={projectId} onFilesChanged={refresh} />
        </div>
      </section>

      {/* Center — preview */}
      <section className="flex flex-col overflow-hidden border-b md:border-b-0 md:border-r">
        <PaneHeader icon={<Monitor className="size-4" />} title="Preview" />
        <div className="flex flex-1 items-center justify-center bg-muted/30 p-6 text-center">
          {hasGame ? (
            <div className="max-w-[36ch]">
              <p className="text-sm font-medium">Game built</p>
              <p className="mt-1 text-xs text-muted-foreground">
                {files.length} files in storage. A live runnable preview (serving index.html from
                storage) lands alongside the publish flow in P4.
              </p>
            </div>
          ) : (
            <div className="max-w-[32ch]">
              <p className="text-sm font-medium">Live game preview</p>
              <p className="mt-1 text-xs text-muted-foreground">
                Describe a game in the chat — the agent builds it and the files appear in the right
                pane.
              </p>
            </div>
          )}
        </div>
      </section>

      {/* Right — files */}
      <section className="flex flex-col overflow-hidden">
        <div className="flex items-center gap-2 border-b px-3 py-2 text-sm font-medium">
          <Code2 className="size-4 text-muted-foreground" />
          Files
          <Button
            size="icon"
            variant="ghost"
            className="ml-auto size-7"
            onClick={refresh}
            disabled={loading}
          >
            <RefreshCw className={loading ? "animate-spin" : ""} />
          </Button>
        </div>
        <ScrollArea className="flex-1">
          <div className="p-2">
            {files.length === 0 ? (
              <p className="px-2 py-6 text-center text-xs text-muted-foreground">
                No files yet. They appear here after a build.
              </p>
            ) : (
              <ul className="space-y-0.5">
                {files.map((f) => (
                  <li
                    key={f}
                    className="flex items-center gap-2 rounded px-2 py-1 font-mono text-xs text-foreground/80 hover:bg-muted"
                  >
                    <FileText className="size-3.5 shrink-0 text-muted-foreground" />
                    <span className="truncate">{f}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </ScrollArea>
      </section>
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
