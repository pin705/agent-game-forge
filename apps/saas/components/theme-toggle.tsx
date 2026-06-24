"use client";

import { Check, Monitor, Moon, Sun } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useTheme, type ThemePref } from "@/lib/theme";
import { useT, type TKey } from "@/lib/i18n";

const OPTIONS: { pref: ThemePref; labelKey: TKey; icon: typeof Sun }[] = [
  { pref: "light", labelKey: "theme.light", icon: Sun },
  { pref: "dark", labelKey: "theme.dark", icon: Moon },
  { pref: "system", labelKey: "theme.system", icon: Monitor },
];

/**
 * Theme control for the top-nav: a ghost icon button (Sun in light, Moon in
 * dark) opening a light / dark / system menu. Shares one source of truth with
 * the settings dialog + command palette via the theme context.
 */
export function ThemeToggle({ className }: { className?: string }) {
  const t = useT();
  const { theme, resolved, setTheme } = useTheme();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          aria-label={t("app.theme")}
          title={t("app.theme")}
          className={className}
        >
          {resolved === "dark" ? <Moon className="size-4" /> : <Sun className="size-4" />}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-44">
        <DropdownMenuLabel className="text-muted-foreground">{t("theme.label")}</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {OPTIONS.map(({ pref, labelKey, icon: Icon }) => (
          <DropdownMenuItem
            key={pref}
            className="cursor-pointer gap-2"
            onSelect={() => setTheme(pref)}
          >
            <Icon className="size-4" />
            <span className="flex-1">{t(labelKey)}</span>
            {theme === pref ? <Check className="size-3.5" /> : null}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
