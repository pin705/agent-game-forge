/**
 * Single source of truth for "who is the current user" across the app.
 *
 * Two environments, matching the rest of the SaaS (publish/conversations/credits
 * all key off the SAME guard):
 *   • prod  (`supabaseConfigured()` === true)  → the REAL Supabase user. No
 *     bypass exists on this path — `getSessionUser()` returns exactly what
 *     `supabase.auth.getUser()` returns (or null).
 *   • local-dev (no/placeholder Supabase)      → a single stable dev user, so
 *     the WHOLE protected app (dashboard → build → editor → billing) is
 *     runnable + browser-testable with ZERO accounts, exactly like the existing
 *     publish/conversations/credits local fallbacks.
 *
 * ──────────────────────────────────────────────────────────────────────────
 *  PROD SAFETY (non-negotiable)
 * ──────────────────────────────────────────────────────────────────────────
 *  The dev-user bypass is gated SOLELY on `supabaseConfigured() === false`,
 *  which is derived ONLY from the SERVER env var `NEXT_PUBLIC_SUPABASE_URL`
 *  (absent or containing "placeholder"). It NEVER reads a request header,
 *  cookie, query param, or any other user-settable input. When Supabase is
 *  configured, `isLocalDev()` is false and the dev branch is unreachable — the
 *  function falls through to the real Supabase path and returns the real user
 *  (or null), so a missing/forged session still fails auth.
 *
 *  Covered by a unit assertion in scripts/prod-safety-test.mjs.
 */

import { createClient } from "@/lib/supabase/server";

/** The fixed dev identity used ONLY in local-dev (no Supabase). */
export const DEV_USER = { id: "dev-user", email: "dev@local" } as const;

export type SessionUser = { id: string; email: string | null };

/**
 * True only when real (non-placeholder) Supabase env is present. This is the
 * EXACT same predicate used everywhere else (lib/billing/credits.ts,
 * lib/publish/core.ts, …) — derived purely from server env.
 */
export function supabaseConfigured(): boolean {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  return Boolean(url && !url.includes("placeholder"));
}

/**
 * True only in local-dev (Supabase NOT configured). The ONLY gate for the
 * dev-user bypass. Negating `supabaseConfigured()` keeps the bypass impossible
 * whenever a real Supabase project is wired.
 */
export function isLocalDev(): boolean {
  return !supabaseConfigured();
}

/**
 * Resolve the current user.
 *
 *  • local-dev → the stable {@link DEV_USER}. (LOUD: dev-only bypass.)
 *  • prod      → the real Supabase user via the request-bound server client,
 *                or null when unauthenticated.
 *
 * Use this anywhere ownership/identity is needed so the local-dev bypass is
 * applied consistently AND can never leak into prod (single gate).
 */
export async function getSessionUser(): Promise<SessionUser | null> {
  // ⚠️ LOCAL-DEV AUTH BYPASS — unreachable in prod (gated on server env only).
  if (isLocalDev()) {
    return { id: DEV_USER.id, email: DEV_USER.email };
  }

  // PROD: the real Supabase user. No bypass past this point.
  // Static import (NOT dynamic): Next 15's server-action compiler mishandles a
  // dynamic import("@/lib/supabase/server") inside an action's graph (emits a
  // missing `_action-browser_*` chunk). A static import is fine — `next/headers`
  // is only *called* at request time, never at module eval. (auth/actions.ts
  // imports the same module statically and works.)
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user ? { id: user.id, email: user.email ?? null } : null;
}
