"use client";

import { requestGuardedNav } from "@/lib/nav-guard";

/**
 * Builder-header brand logo. Navigates to /dashboard THROUGH the unsaved-changes
 * nav guard (same mechanism as DashboardBackButton), so leaving with a dirty
 * editor prompts a confirm. Replaces the global TopNav wordmark on the editor.
 */
export function BuilderBrandLink() {
  return (
    <button
      type="button"
      onClick={() => requestGuardedNav("/dashboard")}
      className="flex shrink-0 items-center rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ring"
      aria-label="Dashboard"
      title="Dashboard"
    >
      <img
        src="/ogf-logo-64.png"
        alt=""
        className="size-6 [image-rendering:pixelated]"
        aria-hidden
      />
    </button>
  );
}
