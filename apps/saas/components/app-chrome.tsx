"use client";

import { createContext, useContext, useMemo, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import {
  Compass,
  CreditCard,
  LayoutDashboard,
  LogOut,
  MessageSquarePlus,
  Plus,
  Settings,
  SunMoon,
} from "lucide-react";
import { signOut } from "@/app/auth/actions";
import { useT } from "@/lib/i18n";
import { useLocale } from "@/lib/i18n";
import { useTheme } from "@/lib/theme";
import {
  CommandPaletteProvider,
  type Command,
} from "@/lib/command-palette";
import { CommandPalette } from "@/components/command-palette";
import { SettingsDialog } from "@/components/settings-dialog";

/**
 * Tiny context so any surface (top-nav button, command palette) can open the
 * settings dialog without prop-drilling.
 */
const SettingsContext = createContext<{ openSettings: () => void } | null>(null);

export function useSettingsDialog() {
  const ctx = useContext(SettingsContext);
  if (!ctx) throw new Error("useSettingsDialog must be used within <AppChrome>");
  return ctx;
}

/**
 * App chrome (Batch 4): mounted once inside the provider tree. Owns the command
 * palette registry + global commands, the settings dialog, and exposes
 * openSettings via context. The build page registers project-scoped commands on
 * top of these globals.
 *
 * `email` is server-fetched in the protected layout and threaded through for the
 * settings "Account" section (null in local-dev / unauthenticated routes).
 */
export function AppChrome({ email, children }: { email: string | null; children: ReactNode }) {
  const t = useT();
  const router = useRouter();
  const { setLocale, locale } = useLocale();
  const { toggle: toggleTheme } = useTheme();
  const [settingsOpen, setSettingsOpen] = useState(false);

  const globalCommands = useMemo<Command[]>(
    () => [
      {
        id: "nav.dashboard",
        group: "navigate",
        label: t("palette.cmd.dashboard"),
        icon: <LayoutDashboard />,
        run: () => router.push("/dashboard"),
      },
      {
        id: "nav.gallery",
        group: "navigate",
        label: t("palette.cmd.gallery"),
        icon: <Compass />,
        run: () => router.push("/gallery"),
      },
      {
        id: "nav.billing",
        group: "navigate",
        label: t("palette.cmd.billing"),
        icon: <CreditCard />,
        run: () => router.push("/billing"),
      },
      {
        id: "nav.newProject",
        group: "navigate",
        label: t("palette.cmd.newProject"),
        icon: <Plus />,
        run: () => router.push("/dashboard"),
      },
      {
        id: "pref.toggleTheme",
        group: "preferences",
        label: t("palette.cmd.toggleTheme"),
        icon: <SunMoon />,
        run: toggleTheme,
      },
      {
        id: "pref.switchLanguage",
        group: "preferences",
        label: t("palette.cmd.switchLanguage"),
        icon: <MessageSquarePlus />,
        run: () => setLocale(locale === "en" ? "vi" : "en"),
      },
      {
        id: "pref.settings",
        group: "preferences",
        label: t("palette.cmd.settings"),
        icon: <Settings />,
        run: () => setSettingsOpen(true),
      },
      {
        id: "pref.signOut",
        group: "preferences",
        label: t("palette.cmd.signOut"),
        icon: <LogOut />,
        run: () => void signOut(),
      },
    ],
    [t, router, toggleTheme, setLocale, locale],
  );

  return (
    <SettingsContext.Provider value={{ openSettings: () => setSettingsOpen(true) }}>
      <CommandPaletteProvider globalCommands={globalCommands}>
        {children}
        <CommandPalette />
        <SettingsDialog open={settingsOpen} onOpenChange={setSettingsOpen} email={email} />
      </CommandPaletteProvider>
    </SettingsContext.Provider>
  );
}
