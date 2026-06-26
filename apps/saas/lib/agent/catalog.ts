/**
 * Model catalog — the user-selectable models for the build composer
 * (SAAS_ARCHITECTURE.md §8 P5 "multi-model tiers", §5 priced per tier).
 *
 * PURE DATA — no server-only imports — so it's shared by the client composer
 * (build-chat.tsx) AND the server (run/model/pricing). The credit weighting is
 * informational (a rough relative cost hint for the UI); the real bill is the
 * sum of per-model `creditsForRun` charges (pricing.ts), which prices by the
 * SAME ids below.
 *
 * Working today: the two DeepSeek ids (our default tier + the cheaper/faster
 * flash tier). "Coming soon": the premium Claude/GPT tiers — their routes are
 * NOT wired (the model layer only speaks the DeepSeek OpenAI-compatible API), so
 * they are rendered DISABLED and the API refuses them (never faked).
 */

export type ModelTier = "deepseek" | "premium";

export type ModelOption = {
  /** Model id — the value plumbed prompt → run → pricing (must match a
   *  pricing.ts rate-table key). */
  id: string;
  /** Human label for the picker. */
  label: string;
  /** Short tagline shown under the label. */
  hint: string;
  tier: ModelTier;
  /** False → rendered disabled ("coming soon"); the API rejects it too. */
  enabled: boolean;
  /**
   * Rough relative credit weighting for the UI (1 = our cheapest tier). Derived
   * loosely from the per-model output rate in pricing.ts; purely a hint.
   */
  creditWeight: number;
};

/** The ordered list the composer renders. */
export const MODEL_OPTIONS: ModelOption[] = [
  {
    id: "deepseek-v4-pro",
    label: "DeepSeek V4 Pro",
    hint: "Best quality · default",
    tier: "deepseek",
    enabled: true,
    creditWeight: 4,
  },
  {
    id: "deepseek-v4-flash",
    label: "DeepSeek V4 Flash",
    hint: "Faster · cheaper",
    tier: "deepseek",
    enabled: true,
    creditWeight: 1,
  },
  {
    id: "premium-claude",
    label: "Claude (premium)",
    hint: "Coming soon",
    tier: "premium",
    enabled: false,
    creditWeight: 50,
  },
  {
    id: "premium-gpt",
    label: "GPT (premium)",
    hint: "Coming soon",
    tier: "premium",
    enabled: false,
    creditWeight: 35,
  },
];

/** The ids a run is allowed to use today (the enabled options). */
export const ENABLED_MODEL_IDS: string[] = MODEL_OPTIONS.filter((m) => m.enabled).map((m) => m.id);

/** True when `id` is a currently-selectable (enabled) model. */
export function isEnabledModel(id: string | undefined | null): id is string {
  return typeof id === "string" && ENABLED_MODEL_IDS.includes(id);
}

/** Look up an option by id (for labels / weighting). */
export function modelOption(id: string): ModelOption | undefined {
  return MODEL_OPTIONS.find((m) => m.id === id);
}
