/**
 * Pricing & credit math — SAAS_ARCHITECTURE.md §5 (credits & billing) + §9
 * (cost / unit economics).
 *
 * One credit = $0.01 (an abstract unit, §5). A run's credit cost is:
 *
 *   rawCostUSD = deepseek_token_cost + image_cost + sandbox_cost
 *   credits    = ceil( rawCostUSD × MARKUP / USD_PER_CREDIT )   (min 1 if non-empty)
 *
 * Everything tunable lives in the single `PRICING` config object below. The
 * numbers here are PLACEHOLDER defaults — §9 says to validate them against ONE
 * metered real build before locking real prices. The user owns these constants:
 * change the per-model rates / markup / sandbox rate here and the whole system
 * (gate, ledger charge, estimate, UI) follows.
 *
 * `creditsForRun` is a pure function (no I/O, no env reads) so it's trivially
 * unit-testable and safe to call from the smoke test.
 */

/** Per-model token rates in USD per 1,000,000 tokens. */
export type ModelRate = {
  /** USD per 1M input (prompt) tokens. */
  inputPerMTok: number;
  /** USD per 1M output (completion) tokens. */
  outputPerMTok: number;
};

export type PricingConfig = {
  /** 1 credit is worth this many USD. §5: 1 credit ≈ $0.01. */
  usdPerCredit: number;
  /**
   * Margin multiplier applied to raw COGS before converting to credits.
   * 2.0 = price each build at 2× our cost (§5: "× markup"). Tune in §9.
   */
  markup: number;
  /**
   * Per-model token rates, keyed by model id. The default model id comes from
   * DEEPSEEK_MODEL (e.g. "deepseek-v4-pro" or "deepseek-v4-flash"). Unknown ids
   * fall back to `defaultModel` so a new/renamed model never crashes a charge.
   * Premium tiers (Claude/GPT) are placeholders until those routes ship (§1/§5).
   */
  models: Record<string, ModelRate>;
  /** Model id used when a run's model isn't in `models`. */
  defaultModel: string;
  /** USD per generated image (image_gen tool). 0 images today — deferred (§3). */
  imageUsd: number;
  /** USD per second the sandbox is alive (E2B per-second compute, §9). */
  sandboxUsdPerSec: number;
};

/**
 * DEFAULT PRICING — placeholder rates for the local/metered build.
 *
 * DeepSeek list prices (approx, USD / 1M tokens) at time of writing are on the
 * order of $0.27 in / $1.10 out for the chat tier; the "flash" tier is cheaper.
 * These are deliberately conservative placeholders — the user locks real
 * numbers after one metered build (§9). Premium tiers are rough stand-ins.
 */
export const PRICING: PricingConfig = {
  usdPerCredit: 0.01, // 1 credit = 1 cent
  markup: 2.0, // price builds at 2× COGS

  models: {
    // DeepSeek V4 Pro — the strong/default tier.
    "deepseek-v4-pro": { inputPerMTok: 0.27, outputPerMTok: 1.1 },
    // Cheaper/faster DeepSeek tier.
    "deepseek-v4-flash": { inputPerMTok: 0.14, outputPerMTok: 0.28 },
    // The MockModel reports its name as "mock-deepseek" (local dev / smoke).
    // Price it like the default tier so local credit math is representative.
    "mock-deepseek": { inputPerMTok: 0.27, outputPerMTok: 1.1 },
    // Premium tiers — PLACEHOLDER until those model routes ship (§5).
    "premium-claude": { inputPerMTok: 3.0, outputPerMTok: 15.0 },
    "premium-gpt": { inputPerMTok: 2.5, outputPerMTok: 10.0 },
  },
  defaultModel: "deepseek-v4-pro",

  imageUsd: 0.04, // ~$0.04 / image (placeholder; free-asset-first keeps this ~0)
  sandboxUsdPerSec: 0.0001, // ~$0.36 / hour of sandbox wall time (placeholder)
};

/** Resolve a model's rate, falling back to the default tier for unknown ids. */
function rateFor(model: string | undefined, cfg: PricingConfig): ModelRate {
  return (model && cfg.models[model]) || cfg.models[cfg.defaultModel];
}

export type RunUsage = {
  model?: string;
  inputTokens: number;
  outputTokens: number;
  /** Count of image-gen tool calls. 0 today (image_gen deferred, §3). */
  images?: number;
  /** Wall time the sandbox was alive, in milliseconds. */
  sandboxMs?: number;
};

/**
 * Raw COGS for a run in USD, BEFORE markup. Exposed for cost reporting / the
 * "worked example" — `creditsForRun` is what actually bills.
 */
export function rawCostUSD(usage: RunUsage, cfg: PricingConfig = PRICING): number {
  const rate = rateFor(usage.model, cfg);
  const tokenCost =
    (usage.inputTokens / 1_000_000) * rate.inputPerMTok +
    (usage.outputTokens / 1_000_000) * rate.outputPerMTok;
  const imageCost = (usage.images ?? 0) * cfg.imageUsd;
  const sandboxCost = ((usage.sandboxMs ?? 0) / 1000) * cfg.sandboxUsdPerSec;
  return tokenCost + imageCost + sandboxCost;
}

/**
 * Credits to charge for a run: COGS × markup ÷ $/credit, rounded UP. A run that
 * did any work (tokens/images/sandbox time) is billed at least 1 credit so a
 * trivial-but-real run is never free. A truly empty usage object → 0.
 *
 * Pure function — no env, no I/O. Safe for unit tests + the smoke test.
 */
export function creditsForRun(usage: RunUsage, cfg: PricingConfig = PRICING): number {
  const cost = rawCostUSD(usage, cfg);
  const credits = (cost * cfg.markup) / cfg.usdPerCredit;
  const ceiled = Math.ceil(credits);
  const didWork =
    usage.inputTokens > 0 ||
    usage.outputTokens > 0 ||
    (usage.images ?? 0) > 0 ||
    (usage.sandboxMs ?? 0) > 0;
  if (didWork) return Math.max(1, ceiled);
  return ceiled; // 0 for an empty run
}

/**
 * Cheap heuristic upper-bound for "show est. cost before a long build" (§5).
 * We don't know how many tokens a build will consume up front, so we guess
 * from the prompt: a long build typically fans out to many model turns reading
 * and writing files. We assume the work scales loosely with prompt size and
 * apply a generous multiplier so the shown estimate errs HIGH (upper bound).
 *
 * Deliberately simple — this is a UI hint, not the bill (the bill is the sum of
 * real `creditsForRun` charges after the run).
 */
export function estimateCredits(prompt: string, cfg: PricingConfig = PRICING): number {
  // ~4 chars per token is the usual rough rule.
  const promptTokens = Math.ceil(prompt.length / 4);
  // A build reads/writes files over many turns: assume total tokens are a
  // sizeable multiple of the prompt, split across input (context re-sent each
  // turn) and output (generated code).
  const estInput = promptTokens * 40; // context accumulates across turns
  const estOutput = promptTokens * 20; // generated code/files
  // Assume a typical ~60s sandbox lifetime for a build.
  const credits = creditsForRun(
    { inputTokens: estInput, outputTokens: estOutput, sandboxMs: 60_000 },
    cfg,
  );
  return Math.max(1, credits);
}
