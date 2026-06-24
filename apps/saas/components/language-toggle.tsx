"use client";

import { Languages } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useLocale, useT, type Locale } from "@/lib/i18n";

/**
 * Compact EN/VI segmented toggle for the top-nav (ported from
 * apps/studio/src/components/LanguageToggle.tsx). Switches the active locale
 * live (no reload) via the existing i18n provider, which persists the choice.
 */
export function LanguageToggle({ className }: { className?: string }) {
  const { locale, setLocale } = useLocale();
  const t = useT();
  const options: { id: Locale; label: string }[] = [
    { id: "en", label: "EN" },
    { id: "vi", label: "VI" },
  ];
  return (
    <div
      className={cn("flex items-center gap-0.5 rounded-md border p-0.5", className)}
      role="group"
      aria-label={t("app.language")}
    >
      <Languages className="ml-1 size-3.5 text-muted-foreground" aria-hidden />
      {options.map((o) => (
        <Button
          key={o.id}
          type="button"
          size="sm"
          variant={locale === o.id ? "secondary" : "ghost"}
          className="h-6 px-2 text-xs"
          aria-pressed={locale === o.id}
          onClick={() => setLocale(o.id)}
        >
          {o.label}
        </Button>
      ))}
    </div>
  );
}
