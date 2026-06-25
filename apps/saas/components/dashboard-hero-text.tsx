"use client";

import { useT } from "@/lib/i18n";

/** Translated hero title + subtitle (studio parity). Client so it reads the
 *  i18n context; the dashboard page itself stays a server component. */
export function DashboardHeroText() {
  const t = useT();
  return (
    <>
      <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">{t("newGame.title")}</h1>
      <p className="mt-2 max-w-md text-sm text-muted-foreground">{t("newGame.subtitle")}</p>
    </>
  );
}

/** Translated "Your games" section heading. */
export function DashboardGamesHeading() {
  const t = useT();
  return (
    <h2 className="mb-4 text-sm font-medium tracking-wide text-muted-foreground">
      {t("dashboard.gamesHeading")}
    </h2>
  );
}
