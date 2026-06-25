"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useT } from "@/lib/i18n";

/**
 * Rename-game dialog (ported from apps/studio/src/components/RenameDialog.tsx).
 * The studio version hit a daemon endpoint; this one calls the supplied async
 * `onRename` (a server action wrapper) so it works for both local-dev + prod.
 */
export function RenameProjectDialog({
  open,
  onOpenChange,
  currentName,
  onRename,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  currentName: string;
  onRename: (name: string) => Promise<void> | void;
}) {
  const t = useT();
  const [name, setName] = useState(currentName);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open) setName(currentName);
  }, [open, currentName]);

  const trimmed = name.trim();
  const canSubmit = trimmed.length > 0 && trimmed !== currentName && !busy;

  async function submit() {
    if (!canSubmit) return;
    setBusy(true);
    try {
      await onRename(trimmed);
      toast.success(t("rename.success", { name: trimmed }));
      onOpenChange(false);
    } catch (err) {
      toast.error(t("rename.failed", { error: err instanceof Error ? err.message : String(err) }));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !busy && onOpenChange(o)}>
      <DialogContent
        className="sm:max-w-md"
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            void submit();
          }
        }}
      >
        <DialogHeader>
          <DialogTitle>{t("rename.title")}</DialogTitle>
          <DialogDescription>{t("rename.description")}</DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          <Label htmlFor="rename-game-name">{t("rename.label")}</Label>
          <Input
            id="rename-game-name"
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={t("rename.placeholder")}
          />
        </div>
        <DialogFooter>
          <DialogClose asChild>
            <Button variant="ghost" disabled={busy}>
              {t("common.cancel")}
            </Button>
          </DialogClose>
          <Button onClick={() => void submit()} disabled={!canSubmit}>
            {busy ? t("common.saving") : t("common.save")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
