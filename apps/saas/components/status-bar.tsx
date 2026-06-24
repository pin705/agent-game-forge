"use client";

import { Circle, Cpu, FolderGit2, Server } from "lucide-react";
import { cn } from "@/lib/utils";
import { useT } from "@/lib/i18n";
import { modelOption } from "@/lib/agent/catalog";

/**
 * Slim builder status bar (Batch 4) — adapted from the studio's StatusBar to the
 * signals the hosted workspace actually has: project name, the active build
 * model, the live run driver (sandbox/storage, only once a run has started), and
 * a save/dirty indicator from the code editor. The studio version showed
 * engine + local filesystem path; neither exists in the cloud model.
 */
export function StatusBar({
  projectName,
  modelId,
  driver,
  dirty,
}: {
  projectName: string;
  modelId: string | null;
  driver: { model: string; sandbox: string; storage: string } | null;
  dirty: boolean;
}) {
  const t = useT();
  const modelLabel = modelId ? (modelOption(modelId)?.label ?? modelId) : null;

  return (
    <div className="flex h-7 shrink-0 items-center gap-3 border-t bg-muted/30 px-4 text-xs text-muted-foreground">
      <span className="flex items-center gap-1.5 truncate" title={projectName}>
        <FolderGit2 className="size-3.5" />
        <span className="truncate">{projectName}</span>
      </span>

      {modelLabel ? (
        <span className="flex items-center gap-1.5" title={t("status.model")}>
          <Cpu className="size-3.5" />
          <span className="font-medium text-foreground/70">{modelLabel}</span>
        </span>
      ) : null}

      {driver ? (
        <span className="hidden items-center gap-1.5 font-mono opacity-70 sm:flex" title={t("status.driver")}>
          <Server className="size-3.5" />
          {driver.sandbox} · {driver.storage}
        </span>
      ) : null}

      <span className="ml-auto flex items-center gap-1.5">
        <Circle className={cn("size-2.5", dirty ? "fill-amber-500 text-amber-500" : "fill-emerald-500 text-emerald-500")} />
        {dirty ? t("status.unsaved") : t("status.saved")}
      </span>
    </div>
  );
}
