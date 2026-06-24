"use client";

import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { requestGuardedNav } from "@/lib/nav-guard";
import { useT } from "@/lib/i18n";

/**
 * Builder-header "Dashboard" back button (Batch 4). Routes through the
 * unsaved-changes nav guard instead of a plain <Link>, so leaving with dirty
 * editor changes prompts a confirm. The workspace owns the dirty state and the
 * confirm modal; this just fires the guarded-nav request.
 */
export function DashboardBackButton() {
  const t = useT();
  return (
    <Button variant="ghost" size="sm" onClick={() => requestGuardedNav("/dashboard")}>
      <ArrowLeft />
      {t("build.dashboard")}
    </Button>
  );
}
