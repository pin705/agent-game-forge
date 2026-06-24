/**
 * SePay (VietQR / bank-transfer) — PURE helpers (no I/O, no env reads, no
 * network). Implements the SAAS_ARCHITECTURE.md §5 top-up flow primitives so
 * they're unit-testable with ZERO accounts:
 *
 *   makeTransferCode()    → a short, unique, memo-safe code we embed in the QR
 *   buildVietQrUrl(...)   → the qr.sepay.vn image URL the user scans
 *   parseSepayWebhook(...)→ normalize the webhook JSON SePay POSTs on a transfer
 *   extractTransferCode() → pull our code back out of the bank memo
 *   verifyWebhookAuth()   → constant-time check of the `Authorization: Apikey` header
 *
 * The flow (bank transfer + QR, NOT cards):
 *   1. User picks a pack → we mint a transfer code + know the VND amount.
 *   2. We render a VietQR whose memo (`des`) carries that code.
 *   3. User pays in any VN banking app; the memo rides along on the transfer.
 *   4. SePay watches the linked bank account and POSTs us a webhook on the
 *      matching incoming transfer.
 *   5. We re-find our pending order by the code in the memo, verify the amount,
 *      and grant credits (idempotently). We NEVER trust amounts/codes from the
 *      body beyond matching a pre-created pending order.
 */

// -----------------------------------------------------------------------------
// Transfer code
// -----------------------------------------------------------------------------

/**
 * Prefix for every transfer code. Short, uppercase, A–Z only so the whole code
 * is uppercase-alphanumeric and survives a bank memo unchanged (banks often
 * uppercase / strip non-alphanumerics from the "nội dung" field).
 */
export const TRANSFER_CODE_PREFIX = "FTG";

/** Charset for the random body of a transfer code: uppercase base36 (0-9A-Z). */
const CODE_ALPHABET = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ";

/**
 * Memo-safe iff: only uppercase letters + digits (no spaces/punctuation), and a
 * sane length. Used to validate a minted code and to scan webhook memos.
 */
export function isMemoSafeCode(code: string): boolean {
  return /^[A-Z0-9]{6,24}$/.test(code);
}

/**
 * Mint a short, unique, memo-safe transfer code, e.g. `FTGK3F9Q2A7`.
 *
 * Uniqueness comes from two independent sources combined into base36:
 *   • a time component (ms since epoch) — monotonic across calls, and
 *   • a random component — guards against collisions within the same ms.
 * Both are uppercased base36 so the result is `[A-Z0-9]` only. The DB column is
 * `unique`, so this is the *probabilistic* guard and the constraint is the hard
 * one; in practice collisions are astronomically unlikely.
 *
 * Pure: takes an optional `rng` (defaults to Math.random) + `now` so the test
 * can force a collision-prone clock and still see distinct codes.
 */
export function makeTransferCode(
  rng: () => number = Math.random,
  now: () => number = Date.now,
): string {
  const time = Math.floor(now()).toString(36).toUpperCase();
  let rand = "";
  for (let i = 0; i < 5; i++) {
    rand += CODE_ALPHABET[Math.floor(rng() * CODE_ALPHABET.length)];
  }
  // Keep the last few of the time part (enough to disambiguate adjacent ms)
  // plus the random tail → compact but collision-resistant, always memo-safe.
  return `${TRANSFER_CODE_PREFIX}${time.slice(-4)}${rand}`;
}

// -----------------------------------------------------------------------------
// VietQR image URL
// -----------------------------------------------------------------------------

export type VietQrParams = {
  /** Receiving bank account number (env SEPAY_BANK_ACCOUNT). */
  account: string;
  /** Bank code/BIN recognised by SePay/VietQR, e.g. "MBBank" (env SEPAY_BANK_CODE). */
  bank: string;
  /** Amount in VND (integer). */
  amountVnd: number;
  /** Our unique transfer code → goes in the QR memo (`des`). */
  transferCode: string;
};

/**
 * Build the SePay-hosted VietQR image URL (no SDK; it's just a GET image):
 *
 *   https://qr.sepay.vn/img?acc=<ACCOUNT>&bank=<BANK>&amount=<AMOUNT>&des=<CODE>
 *
 * The `des` (memo) carries our transfer code so the resulting incoming transfer
 * is identifiable in the webhook. All values are URL-encoded.
 */
export function buildVietQrUrl({ account, bank, amountVnd, transferCode }: VietQrParams): string {
  const qs = new URLSearchParams({
    acc: account,
    bank,
    amount: String(Math.trunc(amountVnd)),
    des: transferCode,
  });
  return `https://qr.sepay.vn/img?${qs.toString()}`;
}

// -----------------------------------------------------------------------------
// Webhook parsing + transfer-code extraction
// -----------------------------------------------------------------------------

/** Normalized shape we work with after parsing SePay's webhook JSON. */
export type SepayWebhook = {
  /** SePay's own transaction id → stored as our `sepay_txn_id` (idempotency). */
  sepayTxnId: string;
  /** Incoming amount in VND. */
  amountVnd: number;
  /** 'in' for money arriving (we only credit incoming transfers). */
  transferType: "in" | "out" | "unknown";
  /** The bank memo / description — CONTAINS our transfer code. */
  memo: string;
  /** SePay's bank reference code (informational). */
  referenceCode: string | null;
  /** Destination bank account number (informational). */
  accountNumber: string | null;
};

/** Coerce SePay's loosely-typed numeric fields (number | numeric string). */
function toNumber(v: unknown): number {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string") {
    const n = Number(v.replace(/[, ]/g, ""));
    if (Number.isFinite(n)) return n;
  }
  return 0;
}

/**
 * Parse + normalize SePay's webhook body. SePay's payload uses these fields
 * (the ones we rely on):
 *   • `id`              → SePay transaction id  (→ sepayTxnId)
 *   • `transferType`    → 'in' | 'out'          (we only credit 'in')
 *   • `transferAmount`  → amount in VND         (→ amountVnd)
 *   • `content` / `description` → the bank memo (carries our transfer code)
 *   • `referenceCode`   → bank reference        (informational)
 *   • `accountNumber`   → receiving account     (informational)
 *
 * Returns null if the body isn't an object or lacks an id — the route then 400s.
 * Tolerant of string-vs-number amounts and either memo field name.
 */
export function parseSepayWebhook(body: unknown): SepayWebhook | null {
  if (!body || typeof body !== "object") return null;
  const b = body as Record<string, unknown>;

  // SePay sends `id` (numeric); accept a couple of historical aliases too.
  const rawId = b.id ?? b.transactionId ?? b.txnId;
  if (rawId === undefined || rawId === null || rawId === "") return null;
  const sepayTxnId = String(rawId);

  const amountVnd = toNumber(b.transferAmount ?? b.amount ?? b.amountIn);

  const tt = String(b.transferType ?? "").toLowerCase();
  const transferType: SepayWebhook["transferType"] =
    tt === "in" ? "in" : tt === "out" ? "out" : "unknown";

  // The memo can arrive as `content` or `description` depending on SePay config.
  const memo = String(b.content ?? b.description ?? "");

  const referenceCode = b.referenceCode != null ? String(b.referenceCode) : null;
  const accountNumber = b.accountNumber != null ? String(b.accountNumber) : null;

  return { sepayTxnId, amountVnd, transferType, memo, referenceCode, accountNumber };
}

/**
 * Pull our transfer code out of a bank memo. Banks frequently mangle the memo —
 * lowercasing, inserting spaces, or prepending bank-added text like
 * "CHUYEN TIEN ... FTGK3F9Q2A7 ... GD 12345" — so we scan case-insensitively
 * for any `FTG`-prefixed memo-safe token rather than expecting an exact match.
 *
 * Returns the FIRST matching code (uppercased to its canonical form) or null.
 */
export function extractTransferCode(memo: string | null | undefined): string | null {
  if (!memo) return null;
  const upper = memo.toUpperCase();
  // FTG followed by 5–20 base36 chars (matches makeTransferCode's output range).
  const re = new RegExp(`${TRANSFER_CODE_PREFIX}[A-Z0-9]{5,20}`, "g");
  const m = upper.match(re);
  return m && m.length > 0 ? m[0] : null;
}

// -----------------------------------------------------------------------------
// Webhook authentication
// -----------------------------------------------------------------------------

/** Constant-time string compare (avoids leaking length/contents via timing). */
function timingSafeEqual(a: string, b: string): boolean {
  // Compare over the max length so the loop count doesn't depend on a match;
  // the length check is folded into the accumulator (not an early return).
  let diff = a.length ^ b.length;
  const len = Math.max(a.length, b.length);
  for (let i = 0; i < len; i++) {
    diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  }
  return diff === 0;
}

/**
 * Verify SePay's `Authorization` header. SePay sends `Authorization: Apikey <key>`;
 * we accept the configured key with or without the `Apikey ` scheme prefix and
 * compare in constant time.
 *
 * Returns false when the expected key is unset (fail closed — never authorize
 * if the server isn't configured) or when the header is absent/mismatched.
 *
 * Pure: both the header value and the expected key are passed in (the route
 * reads them from the request + env).
 */
export function verifyWebhookAuth(
  authHeader: string | null | undefined,
  expectedKey: string | null | undefined,
): boolean {
  if (!expectedKey) return false; // fail closed: not configured ⇒ reject
  if (!authHeader) return false;
  // Strip an optional "Apikey " (case-insensitive) scheme prefix.
  const presented = authHeader.replace(/^\s*Apikey\s+/i, "").trim();
  if (!presented) return false;
  return timingSafeEqual(presented, expectedKey);
}
