"use client";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { useT } from "@/lib/i18n";

/**
 * Unsaved-editor-changes guard (adapted from the studio's PendingChangesModal,
 * whose daemon sidecar/slice review flow doesn't exist in the hosted model).
 * Here it's a plain "discard vs keep editing" confirm: a surface holding dirty
 * Monaco edits opens it when the user tries to navigate away.
 */
export function UnsavedChangesModal({
  open,
  onOpenChange,
  fileName,
  onDiscard,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The dirty file's name, shown in the warning copy. */
  fileName: string;
  /** Proceed with the navigation, discarding the edits. */
  onDiscard: () => void;
}) {
  const t = useT();
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t("unsaved.title")}</DialogTitle>
          <DialogDescription>{t("unsaved.body", { file: fileName })}</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            {t("unsaved.keep")}
          </Button>
          <Button
            variant="destructive"
            onClick={() => {
              onDiscard();
              onOpenChange(false);
            }}
          >
            {t("unsaved.discard")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
