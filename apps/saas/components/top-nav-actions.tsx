"use client";

import { Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useCommandPalette } from "@/lib/command-palette";
import { useT } from "@/lib/i18n";

/**
 * Client-side top-nav control: the ⌘K palette trigger. Theme + language toggles
 * were moved OUT of the header into Settings (they live there now) to keep the
 * header compact; this stays split out so TopNav's server bits stay server-side.
 */
export function TopNavActions() {
  const t = useT();
  const { setOpen } = useCommandPalette();
  return (
    <Button
      variant="ghost"
      size="sm"
      className="hidden items-center gap-1.5 text-xs text-muted-foreground sm:inline-flex"
      onClick={() => setOpen(true)}
      title={t("palette.open")}
      aria-label={t("palette.open")}
    >
      <Search className="size-3.5" />
      <kbd className="rounded border bg-muted px-1 py-0.5 font-mono text-[10px] leading-none">⌘K</kbd>
    </Button>
  );
}
