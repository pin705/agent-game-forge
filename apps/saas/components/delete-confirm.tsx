"use client";

import { useState } from "react";
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
import { useT } from "@/lib/i18n";

/**
 * Reusable destructive-confirm dialog (ported & generalised from
 * apps/studio/src/components/DeleteConfirm.tsx). The studio version hit a fixed
 * daemon delete endpoint; this one is agnostic — the caller passes an async
 * `onConfirm`, so it wires to project / conversation / file deletes alike.
 */
export function DeleteConfirm({
  open,
  onOpenChange,
  name,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Display name shown in the confirmation copy. */
  name: string;
  /** Performs the delete; the dialog closes on resolve, stays open on throw. */
  onConfirm: () => Promise<void> | void;
}) {
  const t = useT();
  const [busy, setBusy] = useState(false);

  async function confirm() {
    setBusy(true);
    try {
      await onConfirm();
      onOpenChange(false);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !busy && onOpenChange(o)}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t("delete.title", { name })}</DialogTitle>
          <DialogDescription>{t("delete.body")}</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <DialogClose asChild>
            <Button variant="ghost" disabled={busy}>
              {t("common.cancel")}
            </Button>
          </DialogClose>
          <Button variant="destructive" onClick={() => void confirm()} disabled={busy}>
            {busy ? t("delete.removing") : t("delete.confirm")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
