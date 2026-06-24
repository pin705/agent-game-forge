// UI preferences persisted to localStorage (Batch 4 settings surface).
//
// Hosted-model scope: the ONLY build pref that makes sense client-side is the
// user's default build model (pre-selected in new chats). API keys, Cloudflare
// tokens, agent-CLI selection, reasoning effort, and gen-image usage — all of
// the studio SettingsDialog's other fields — are server-side env or obsolete in
// the SaaS and are intentionally NOT surfaced here (no client secret entry).
//
// Pure helpers (validation + read) are unit-tested in scripts/ui-test.mjs.

import { ENABLED_MODEL_IDS, MODEL_OPTIONS } from "@/lib/agent/catalog";

export const DEFAULT_MODEL_LS_KEY = "ogf_saas_default_model";

/** The first enabled catalog model — the system default before any user pref. */
export function fallbackModelId(): string {
  return MODEL_OPTIONS.find((m) => m.enabled)?.id ?? "deepseek-chat";
}

/**
 * Validate a stored/candidate model id against the ENABLED catalog. A disabled
 * ("coming soon") or unknown id is rejected so the composer never preselects a
 * model the API will refuse. Pure — safe to call on the server.
 */
export function resolveDefaultModel(candidate: string | null | undefined): string {
  if (typeof candidate === "string" && ENABLED_MODEL_IDS.includes(candidate)) {
    return candidate;
  }
  return fallbackModelId();
}

/** Read the persisted default model (validated). Client-only. */
export function readDefaultModel(): string {
  try {
    return resolveDefaultModel(localStorage.getItem(DEFAULT_MODEL_LS_KEY));
  } catch {
    return fallbackModelId();
  }
}

/** Persist the default model (validated before write). Client-only. */
export function writeDefaultModel(id: string): void {
  try {
    localStorage.setItem(DEFAULT_MODEL_LS_KEY, resolveDefaultModel(id));
  } catch {
    /* storage disabled — applies for this session only */
  }
}
