/**
 * Cost / call logging for /api/gen-image. One row per call.
 *
 * Estimated cost is HEURISTIC — provider pricing changes frequently and
 * exact billing varies by tier. We use a conservative middle-of-the-road
 * USD-per-image figure published in the providers' pricing docs as of
 * 2026-05. Treat the number as "rough order of magnitude" — if exact
 * billing matters, point users to the provider's dashboard.
 */

import type { GenImageProvider } from './gen-image.js';
import { getDb } from './db.js';

/** USD per 1024×1024 image, ballpark. Update when providers change pricing. */
const COST_PER_IMAGE: Record<GenImageProvider, Record<string, number>> = {
  gemini: {
    // Gemini 2.5 Flash Image is ~$0.039/image at 1024×1024 (image-out tier).
    'gemini-2.5-flash-image': 0.039,
    default: 0.039,
  },
  openai: {
    // gpt-image-1 medium quality 1024×1024 ~ $0.04, high quality ~$0.17.
    // Use a middle-ground figure since the daemon doesn't currently pin
    // quality; users can override via --model.
    'gpt-image-1': 0.04,
    'gpt-image-2': 0.05,
    default: 0.04,
  },
};

export function estimateCostUsd(provider: GenImageProvider, model: string): number {
  const table = COST_PER_IMAGE[provider];
  return table[model] ?? table.default;
}

export interface GenImageLogEntry {
  provider: GenImageProvider;
  model: string;
  sizeBytes: number;
  ok: boolean;
  durationMs: number;
  error?: string;
}

export function logGenImageCall(entry: GenImageLogEntry): void {
  const db = getDb();
  const cost = entry.ok ? estimateCostUsd(entry.provider, entry.model) : 0;
  db.prepare(
    `INSERT INTO gen_image_calls
       (ts, provider, model, size_bytes, ok, est_cost_usd, duration_ms, error)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    Date.now(),
    entry.provider,
    entry.model,
    entry.sizeBytes,
    entry.ok ? 1 : 0,
    cost,
    entry.durationMs,
    entry.error ?? null,
  );
}

export interface GenImageSummaryRow {
  provider: GenImageProvider;
  count: number;
  okCount: number;
  errorCount: number;
  estCostUsd: number;
}

export interface GenImageSummary {
  /** Window: last 24 hours by default. */
  windowMs: number;
  totalCount: number;
  totalEstCostUsd: number;
  byProvider: GenImageSummaryRow[];
}

/** Aggregate counts + estimated spend for the last `windowMs` (default 24h).
 *  Surfaced in the Settings panel so users see "today's spend at a glance". */
export function summarizeGenImageCalls(windowMs = 24 * 60 * 60 * 1000): GenImageSummary {
  const db = getDb();
  const since = Date.now() - windowMs;
  const rows = db
    .prepare(
      `SELECT provider,
              COUNT(*) AS count,
              SUM(ok)  AS ok_count,
              SUM(est_cost_usd) AS est_cost_usd
         FROM gen_image_calls
         WHERE ts >= ?
         GROUP BY provider
         ORDER BY count DESC`,
    )
    .all(since) as Array<{
    provider: string;
    count: number;
    ok_count: number;
    est_cost_usd: number;
  }>;

  const byProvider: GenImageSummaryRow[] = rows.map((r) => ({
    provider: r.provider as GenImageProvider,
    count: Number(r.count) || 0,
    okCount: Number(r.ok_count) || 0,
    errorCount: (Number(r.count) || 0) - (Number(r.ok_count) || 0),
    estCostUsd: Number(r.est_cost_usd) || 0,
  }));

  return {
    windowMs,
    totalCount: byProvider.reduce((s, r) => s + r.count, 0),
    totalEstCostUsd: byProvider.reduce((s, r) => s + r.estCostUsd, 0),
    byProvider,
  };
}
