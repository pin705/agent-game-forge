"use client";

import { Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ThemeToggle } from "@/components/theme-toggle";
import { LanguageToggle } from "@/components/language-toggle";
import { useCommandPalette } from "@/lib/command-palette";
import { useT } from "@/lib/i18n";

/**
 * Client-side cluster of top-nav chrome controls (Batch 4): the ⌘K palette
 * trigger, theme toggle, and language toggle. Split out of the server-rendered
 * TopNav so those server bits (email/credits/links) stay server components.
 */
export function TopNavActions() {
  const t = useT();
  const { setOpen } = useCommandPalette();
  return (
    <>
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
      <LanguageToggle className="hidden sm:flex" />
      <ThemeToggle />
    </>
  );
}
