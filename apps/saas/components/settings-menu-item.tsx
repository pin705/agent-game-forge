"use client";

import { Settings } from "lucide-react";
import { DropdownMenuItem } from "@/components/ui/dropdown-menu";
import { useSettingsDialog } from "@/components/app-chrome";
import { useT } from "@/lib/i18n";

/** Opens the settings dialog from the top-nav user dropdown (Batch 4). */
export function SettingsMenuItem() {
  const t = useT();
  const { openSettings } = useSettingsDialog();
  return (
    <DropdownMenuItem className="cursor-pointer" onSelect={() => openSettings()}>
      <Settings />
      {t("app.settings")}
    </DropdownMenuItem>
  );
}
