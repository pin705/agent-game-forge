/**
 * P3 payments unit test — proves the PURE SePay logic with ZERO accounts
 * (no SePay, no Supabase, no network). Run:
 *
 *   npm run payments-test      (uses tsx — resolves the `@/` tsconfig alias)
 *     or: npx tsx scripts/payments-test.mjs
 *
 * Asserts:
 *   (a) makeTransferCode() is unique + memo-safe across N calls (incl. a
 *       collision-prone fixed clock),
 *   (b) buildVietQrUrl(...) produces the correct qr.sepay.vn/img?… URL with our
 *       code in `des`,
 *   (c) parseSepayWebhook(...) + extractTransferCode(...) pull the txn id /
 *       amount / our code out of realistic SePay bodies (incl. a code buried in
 *       a longer, bank-mangled memo, and a string amount + `description` alias),
 *   (d) the webhook auth check rejects a wrong/absent Apikey and accepts the
 *       right one (with/without the `Apikey ` scheme prefix), and fails closed
 *       when no key is configured.
 */
import {
  buildVietQrUrl,
  extractTransferCode,
  isMemoSafeCode,
  makeTransferCode,
  parseSepayWebhook,
  TRANSFER_CODE_PREFIX,
  verifyWebhookAuth,
} from "../lib/payments/sepay.ts";

let pass = true;
const check = (label, ok) => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}`);
  if (!ok) pass = false;
};
const eq = (label, got, want) =>
  check(`${label} (got ${JSON.stringify(got)})`, got === want);

console.log("\n=== P3 payments unit test (no accounts) ===\n");

// ── (a) transfer code: uniqueness + memo-safety ─────────────────────────────
console.log("--- (a) makeTransferCode: unique + memo-safe ---");
{
  const N = 5000;
  const seen = new Set();
  let allSafe = true;
  for (let i = 0; i < N; i++) {
    const code = makeTransferCode();
    if (!isMemoSafeCode(code)) allSafe = false;
    seen.add(code);
  }
  eq(`${N} codes are all unique`, seen.size, N);
  check(`all codes are memo-safe (${TRANSFER_CODE_PREFIX}+[A-Z0-9])`, allSafe);

  // Collision-prone: FROZEN clock, so uniqueness must come from the RNG body.
  const frozenNow = () => 1_700_000_000_000;
  let rngState = 12345;
  const lcg = () => {
    // deterministic but well-spread PRNG so distinct codes are expected
    rngState = (rngState * 1103515245 + 12345) & 0x7fffffff;
    return rngState / 0x7fffffff;
  };
  const seen2 = new Set();
  const M = 2000;
  for (let i = 0; i < M; i++) seen2.add(makeTransferCode(lcg, frozenNow));
  // With a 5-char base36 random tail (36^5 ≈ 60M) collisions across 2k draws
  // are highly unlikely; assert we got the vast majority distinct.
  check(`${M} codes under a FROZEN clock stay (near-)unique (${seen2.size})`, seen2.size >= M - 1);

  // Memo-safety of a code embedded then re-extracted survives round-trip.
  const sample = makeTransferCode();
  check("sample code has the FTG prefix", sample.startsWith(TRANSFER_CODE_PREFIX));
}

// ── (b) VietQR URL ──────────────────────────────────────────────────────────
console.log("\n--- (b) buildVietQrUrl ---");
{
  const url = buildVietQrUrl({
    account: "0123456789",
    bank: "MBBank",
    amountVnd: 55000,
    transferCode: "FTGABCD123",
  });
  const u = new URL(url);
  eq("origin+path is qr.sepay.vn/img", `${u.origin}${u.pathname}`, "https://qr.sepay.vn/img");
  eq("acc param", u.searchParams.get("acc"), "0123456789");
  eq("bank param", u.searchParams.get("bank"), "MBBank");
  eq("amount param (integer string)", u.searchParams.get("amount"), "55000");
  eq("des param carries our transfer code", u.searchParams.get("des"), "FTGABCD123");

  // amount is truncated to an integer (VND has no minor unit).
  const url2 = buildVietQrUrl({ account: "1", bank: "ACB", amountVnd: 20000.9, transferCode: "FTGX1" });
  eq("amount truncated to integer", new URL(url2).searchParams.get("amount"), "20000");
}

// ── (c) webhook parse + code extraction ─────────────────────────────────────
console.log("\n--- (c) parseSepayWebhook + extractTransferCode ---");
{
  // Realistic SePay incoming-transfer body (clean memo == exact code).
  const body1 = {
    id: 92704,
    gateway: "MBBank",
    transactionDate: "2026-06-24 09:31:02",
    accountNumber: "0123456789",
    transferType: "in",
    transferAmount: 55000,
    referenceCode: "FT26175ABCDE",
    content: "FTGABCD123",
    description: "FTGABCD123",
  };
  const h1 = parseSepayWebhook(body1);
  check("parse: non-null", !!h1);
  eq("parse: sepayTxnId from `id`", h1?.sepayTxnId, "92704");
  eq("parse: amountVnd from `transferAmount`", h1?.amountVnd, 55000);
  eq("parse: transferType 'in'", h1?.transferType, "in");
  eq("extract: exact-memo code", extractTransferCode(h1?.memo), "FTGABCD123");

  // Code BURIED in a longer, bank-mangled memo (lowercased, extra words, refs).
  const body2 = {
    id: "92705",
    transferType: "in",
    transferAmount: "170,000", // string + thousands separator
    description: "chuyen tien mua credits ftgxy9z12 noi dung gd 0987654321 ngay 24/06",
    accountNumber: "0123456789",
  };
  const h2 = parseSepayWebhook(body2);
  eq("parse: string id coerced", h2?.sepayTxnId, "92705");
  eq("parse: string amount with comma coerced", h2?.amountVnd, 170000);
  eq("parse: memo via `description` alias", h2?.memo, body2.description);
  eq("extract: code buried in long lowercased memo", extractTransferCode(h2?.memo), "FTGXY9Z12");

  // Outgoing transfer → transferType 'out' (route ignores these).
  const h3 = parseSepayWebhook({ id: 1, transferType: "out", transferAmount: 1000, content: "x" });
  eq("parse: outgoing → 'out'", h3?.transferType, "out");

  // No code present → null (route acks + ignores).
  eq("extract: no code in memo → null", extractTransferCode("thanh toan don hang 123"), null);
  // Empty / missing memo → null.
  eq("extract: empty memo → null", extractTransferCode(""), null);

  // Garbage bodies → null (route 400s).
  check("parse: non-object → null", parseSepayWebhook("nope") === null);
  check("parse: missing id → null", parseSepayWebhook({ transferAmount: 1 }) === null);
}

// ── (d) webhook auth check ──────────────────────────────────────────────────
console.log("\n--- (d) verifyWebhookAuth ---");
{
  const KEY = "sk_test_sepay_secret_abc123";
  check("accepts `Apikey <key>`", verifyWebhookAuth(`Apikey ${KEY}`, KEY));
  check("accepts bare key (no scheme)", verifyWebhookAuth(KEY, KEY));
  check("accepts case-insensitive scheme `APIKEY`", verifyWebhookAuth(`APIKEY ${KEY}`, KEY));
  check("rejects wrong key", verifyWebhookAuth("Apikey wrong-key", KEY) === false);
  check("rejects absent header", verifyWebhookAuth(null, KEY) === false);
  check("rejects empty header", verifyWebhookAuth("", KEY) === false);
  check("rejects scheme-only header", verifyWebhookAuth("Apikey ", KEY) === false);
  check("fails closed when key unconfigured", verifyWebhookAuth(`Apikey ${KEY}`, "") === false);
  check("fails closed when key undefined", verifyWebhookAuth(`Apikey ${KEY}`, undefined) === false);
  // A prefix of the real key must NOT pass (constant-time compare guards length).
  check("rejects a truncated prefix of the key", verifyWebhookAuth(KEY.slice(0, -1), KEY) === false);
}

console.log(`\n=== ${pass ? "ALL CHECKS PASSED" : "PAYMENTS TEST FAILED"} ===\n`);
process.exit(pass ? 0 : 1);
