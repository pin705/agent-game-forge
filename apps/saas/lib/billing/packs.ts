/**
 * Credit packs — the top-up SKUs a user can buy via SePay/VietQR (§5 top-up,
 * §10 #5 "VND credit packs"). A pack maps a one-off VND payment to a fixed
 * number of credits granted on a verified incoming transfer.
 *
 * Pure config + a `getPack` lookup — no I/O, no env. Safe to import anywhere
 * (server routes, the billing UI, the unit test).
 *
 * ── PRICING IS A PLACEHOLDER (TUNABLE) ──────────────────────────────────────
 * The `amountVnd` numbers below are deliberate placeholders. §9 says to set the
 * real prices once ONE metered real build gives the per-build COGS (DeepSeek
 * tokens + image-gen + sandbox seconds, see lib/billing/pricing.ts). A credit is
 * an abstract unit (§5: 1 credit ≈ $0.01); the VND price per pack should be
 * `credits × $/credit × USD→VND × markup`, rounded to a friendly amount. The
 * user owns these numbers: edit this array and the whole flow (UI, QR amount,
 * webhook amount check, grant) follows. Larger packs give a small bonus
 * (cheaper per credit) to nudge bigger top-ups — standard funnel.
 */

export type CreditPack = {
  /** Stable id, used as the API `packId` and the order's pack reference. */
  id: string;
  /** Credits granted when a payment for this pack is verified. */
  credits: number;
  /** Price in Vietnamese đồng (integer; VND has no minor unit). */
  amountVnd: number;
  /** Short human label for the UI (Vietnamese-friendly). */
  label: string;
};

/**
 * The catalogue. Order = display order in the UI. PLACEHOLDER VND prices (see
 * the file header) — roughly 1 credit ≈ 200₫ at the small tier, with a mild
 * bonus on bigger packs. Tune per §9 after a metered build.
 */
export const CREDIT_PACKS: readonly CreditPack[] = [
  { id: "starter", credits: 100, amountVnd: 20_000, label: "Gói Khởi đầu" }, // Starter
  { id: "standard", credits: 300, amountVnd: 55_000, label: "Gói Tiêu chuẩn" }, // Standard (≈8% bonus)
  { id: "pro", credits: 1_000, amountVnd: 170_000, label: "Gói Pro" }, // Pro (≈15% bonus)
] as const;

/** Look up a pack by id. Returns undefined for an unknown id (caller 400s). */
export function getPack(id: string | undefined | null): CreditPack | undefined {
  if (!id) return undefined;
  return CREDIT_PACKS.find((p) => p.id === id);
}
