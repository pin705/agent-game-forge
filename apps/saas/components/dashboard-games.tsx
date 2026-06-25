"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { Pencil, Play, MoreVertical } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { GameCover } from "@/components/game-cover";
import { RenameProjectDialog } from "@/components/rename-project-dialog";
import { DeleteConfirm } from "@/components/delete-confirm";
import { renameProject, deleteProject } from "@/app/(app)/dashboard/actions";
import { useT, type TKey } from "@/lib/i18n";

/** Serializable project shape passed from the server dashboard page. */
export type DashboardProject = {
  id: string;
  name: string;
  engine: string;
  /** Epoch millis of last update (null → "recently"). */
  updatedAtMs: number | null;
};

type TFn = (key: TKey, vars?: Record<string, string | number>) => string;

function timeAgo(ts: number | null, t: TFn): string {
  if (!ts) return t("time.recently");
  const s = (Date.now() - ts) / 1000;
  if (s < 60) return t("time.justNow");
  if (s < 3600) return t("time.minutesAgo", { n: Math.floor(s / 60) });
  if (s < 86400) return t("time.hoursAgo", { n: Math.floor(s / 3600) });
  return t("time.daysAgo", { n: Math.floor(s / 86400) });
}

/**
 * Studio-style game grid (ported from apps/studio/src/pages/Dashboard.tsx's
 * games section): a cover thumbnail, the name, an engine badge + "edited … ago",
 * Play + Edit buttons, and a ⋮ menu (Rename / Duplicate=coming-soon / Remove).
 * Rename + Remove call the dashboard server actions (local-dev + prod).
 */
export function DashboardGames({ projects }: { projects: DashboardProject[] }) {
  const t = useT();
  const [renameFor, setRenameFor] = useState<DashboardProject | null>(null);
  const [deleteFor, setDeleteFor] = useState<DashboardProject | null>(null);
  const [, startTransition] = useTransition();

  if (projects.length === 0) {
    return (
      <div className="rounded-lg border border-dashed py-10 text-center text-sm text-muted-foreground">
        {t("dashboard.empty.body")}
      </div>
    );
  }

  return (
    <>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {projects.map((p) => (
          <Card key={p.id} className="overflow-hidden">
            <Link href={`/build/${p.id}`} className="block">
              <GameCover projectId={p.id} className="h-28" />
            </Link>
            <div className="p-4">
              <div className="flex items-start justify-between gap-2">
                <Link href={`/build/${p.id}`} className="truncate font-medium hover:underline">
                  {p.name}
                </Link>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="ghost" size="icon" className="size-7 shrink-0 text-muted-foreground">
                      <MoreVertical />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem onClick={() => setRenameFor(p)}>
                      <Pencil />
                      {t("common.rename")}
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      onClick={() => toast(t("common.comingSoon", { feature: t("dashboard.duplicate") }))}
                    >
                      {t("dashboard.duplicate")}
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem className="text-destructive" onClick={() => setDeleteFor(p)}>
                      {t("common.remove")}
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
              <div className="mt-1 flex items-center gap-2">
                <Badge variant="secondary" className="capitalize">
                  {p.engine}
                </Badge>
                <span className="text-xs text-muted-foreground">
                  {t("dashboard.card.editedAgo", { when: timeAgo(p.updatedAtMs, t) })}
                </span>
              </div>
              <div className="mt-3 flex gap-2">
                <Button asChild size="sm" variant="secondary" className="flex-1">
                  <Link href={`/build/${p.id}`}>
                    <Play />
                    {t("dashboard.card.play")}
                  </Link>
                </Button>
                <Button asChild size="sm" variant="secondary" className="flex-1">
                  <Link href={`/build/${p.id}`}>
                    <Pencil />
                    {t("dashboard.card.edit")}
                  </Link>
                </Button>
              </div>
            </div>
          </Card>
        ))}
      </div>

      <RenameProjectDialog
        open={!!renameFor}
        onOpenChange={(o) => !o && setRenameFor(null)}
        currentName={renameFor?.name ?? ""}
        onRename={async (name) => {
          if (renameFor) await renameProject(renameFor.id, name);
        }}
      />
      <DeleteConfirm
        open={!!deleteFor}
        onOpenChange={(o) => !o && setDeleteFor(null)}
        name={deleteFor?.name ?? ""}
        onConfirm={async () => {
          const target = deleteFor;
          if (!target) return;
          await deleteProject(target.id);
          startTransition(() => {});
        }}
      />
    </>
  );
}
