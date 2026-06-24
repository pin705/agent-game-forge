// Tiny window-event bridge for guarded in-app navigation (Batch 4).
//
// The builder header's "Dashboard" link lives in a Server Component, outside the
// workspace's React tree where the editor dirty-state lives. Rather than thread
// state across that boundary, the link dispatches a NAV_GUARD_EVENT with its
// target href; the workspace listens, and EITHER navigates immediately (clean)
// OR shows the UnsavedChangesModal first (dirty). Mirrors the publish / focus
// chat event bridges in command-palette.tsx.

export const NAV_GUARD_EVENT = "ogf:nav-guard";

export interface NavGuardDetail {
  href: string;
}

/** Request a guarded navigation to `href` (no-op outside the browser). */
export function requestGuardedNav(href: string): void {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent<NavGuardDetail>(NAV_GUARD_EVENT, { detail: { href } }));
  }
}
