"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { CreditCard, Monitor, Moon, Sun } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { useT, useLocale, type Locale } from "@/lib/i18n";
import { useTheme, type ThemePref } from "@/lib/theme";
import { MODEL_OPTIONS } from "@/lib/agent/catalog";
import { readDefaultModel, writeDefaultModel } from "@/lib/prefs";

const THEME_OPTIONS: { pref: ThemePref; labelKey: "theme.light" | "theme.dark" | "theme.system"; icon: typeof Sun }[] = [
  { pref: "light", labelKey: "theme.light", icon: Sun },
  { pref: "dark", labelKey: "theme.dark", icon: Moon },
  { pref: "system", labelKey: "theme.system", icon: Monitor },
];

function SettingsBody({ email }: { email: string | null }) {
  const t = useT();
  const { locale, setLocale } = useLocale();
  const { theme, setTheme } = useTheme();
  const [defaultModel, setDefaultModel] = useState<string>(() => MODEL_OPTIONS[0].id);

  // Hydrate persisted default model after mount (client-only storage read).
  useEffect(() => {
    setDefaultModel(readDefaultModel());
  }, []);

  function onModelChange(id: string) {
    setDefaultModel(id);
    writeDefaultModel(id);
  }

  return (
    <div className="grid gap-6">
      {/* Appearance: theme segmented control */}
      <section className="grid gap-2">
        <Label>{t("settings.appearance")}</Label>
        <div className="grid grid-cols-3 gap-2">
          {THEME_OPTIONS.map(({ pref, labelKey, icon: Icon }) => (
            <button
              key={pref}
              type="button"
              onClick={() => setTheme(pref)}
              aria-pressed={theme === pref}
              className={cn(
                "flex flex-col items-center gap-1.5 rounded-md border px-3 py-3 text-xs transition-colors",
                theme === pref ? "border-primary bg-accent" : "hover:bg-accent/50",
              )}
            >
              <Icon className="size-4" />
              {t(labelKey)}
            </button>
          ))}
        </div>
      </section>

      {/* Language */}
      <section className="grid gap-2">
        <Label htmlFor="settings-language">{t("app.language")}</Label>
        <Select value={locale} onValueChange={(v) => setLocale(v as Locale)}>
          <SelectTrigger id="settings-language">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="en">{t("app.language.en")}</SelectItem>
            <SelectItem value="vi">{t("app.language.vi")}</SelectItem>
          </SelectContent>
        </Select>
      </section>

      <Separator />

      {/* Default build model — the one client-side build pref that's hosted-safe. */}
      <section className="grid gap-2">
        <Label htmlFor="settings-model">{t("settings.defaultModel")}</Label>
        <Select value={defaultModel} onValueChange={onModelChange}>
          <SelectTrigger id="settings-model">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {MODEL_OPTIONS.map((m) => (
              <SelectItem key={m.id} value={m.id} disabled={!m.enabled}>
                {m.label}
                {!m.enabled ? ` · ${m.hint}` : ""}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <p className="text-xs text-muted-foreground">{t("settings.defaultModel.hint")}</p>
      </section>

      <Separator />

      {/* Account — read-only email + billing link. No secrets, no CLI import. */}
      <section className="grid gap-2">
        <Label>{t("settings.account")}</Label>
        <div className="rounded-md border bg-muted/30 px-3 py-2 text-sm">
          {email ? (
            <>
              <span className="text-muted-foreground">{t("settings.account.email")} </span>
              <span className="font-medium">{email}</span>
            </>
          ) : (
            <span className="text-muted-foreground">{t("settings.account.local")}</span>
          )}
        </div>
        <Button asChild variant="outline" size="sm" className="justify-start">
          <Link href="/billing">
            <CreditCard className="size-4" />
            {t("settings.account.billing")}
          </Link>
        </Button>
      </section>
    </div>
  );
}

/**
 * SaaS settings dialog (Batch 4). Ported from the studio's SettingsDialog but
 * trimmed to the hosted-safe surface: appearance (theme), language, default
 * build model, and read-only account info + a billing link.
 *
 * DELIBERATELY DROPPED vs. the studio version (server-side env or obsolete in
 * the hosted model — never re-introduced as client fields):
 *   • API-key entry (Gemini / OpenAI)        → server env on the worker
 *   • Cloudflare publish token / account id  → server env / managed publish
 *   • Agent-CLI radio (Codex vs Claude Code) → the SaaS uses a single hosted loop
 *   • reasoning-effort select                → not exposed to end users
 *   • gen-image cost summary                 → belongs in billing/usage, not here
 */
export function SettingsDialog({
  open,
  onOpenChange,
  email,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  email: string | null;
}) {
  const t = useT();
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t("settings.title")}</DialogTitle>
          <DialogDescription>{t("settings.description")}</DialogDescription>
        </DialogHeader>
        {open && <SettingsBody email={email} />}
      </DialogContent>
    </Dialog>
  );
}
