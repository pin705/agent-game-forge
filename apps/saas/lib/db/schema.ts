// =============================================================================
// Drizzle schema — CANONICAL definition of the Footage SaaS Postgres schema.
//
// This is a faithful port of the manual SQL in `supabase/migrations/0001_init.sql`
// + `0004_publish.sql` (now legacy/reference). drizzle-kit generates the table
// DDL from this file; the RLS policies, the three SECURITY DEFINER functions
// (record_run_charge / grant_credits / increment_play_count), and the
// `handle_new_user` signup trigger live in the hand-written custom migration
// `drizzle/0001_rls_and_functions.sql` (Drizzle's DSL can't express plpgsql).
//
// SCOPE NOTE: Drizzle owns the SCHEMA + MIGRATIONS only. The app's request path
// keeps querying through `@supabase/ssr` (lib/supabase/server.ts) so RLS stays
// enforced per-request. NOTHING in the app's runtime should import this file —
// it is consumed by drizzle-kit (a dev/migration-time tool) only. Keep it
// import-clean (no `next/headers`, no server-only modules).
//
// `auth.users` is owned/managed by Supabase. We declare a MINIMAL reference to
// it purely so foreign keys can target `auth.users(id)`. drizzle.config.ts pins
// `schemaFilter: ['public']` so drizzle-kit NEVER tries to create/alter/drop the
// `auth` (or `storage`) schema.
// =============================================================================

import {
  boolean,
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  pgSchema,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

// -----------------------------------------------------------------------------
// auth.users — Supabase-managed. Declared ONLY so FKs can reference auth.users(id).
// drizzle-kit will not manage this (schemaFilter restricts it to 'public').
// -----------------------------------------------------------------------------
const authSchema = pgSchema("auth");

export const authUsers = authSchema.table("users", {
  id: uuid("id").primaryKey(),
});

// =============================================================================
// public.profiles — 1:1 with auth.users. `id` IS the user id (child-table RLS
// compares to auth.uid() directly). credits_balance defaults to 50 (free grant).
// =============================================================================
export const profiles = pgTable("profiles", {
  id: uuid("id")
    .primaryKey()
    .references(() => authUsers.id, { onDelete: "cascade" }),
  creditsBalance: integer("credits_balance").notNull().default(50),
  plan: text("plan").notNull().default("free"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

// =============================================================================
// public.projects — incl. the P4 publish/remix columns (is_published,
// published_at, play_count, remixed_from).
// =============================================================================
export const projects = pgTable(
  "projects",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    userId: uuid("user_id")
      .notNull()
      .references(() => authUsers.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    slug: text("slug").notNull(),
    engine: text("engine").notNull().default("canvas"),
    r2Prefix: text("r2_prefix").notNull(),
    publishedUrl: text("published_url"),
    // --- P4 publish state + remix lineage (0004_publish.sql) ---
    isPublished: boolean("is_published").notNull().default(false),
    publishedAt: timestamp("published_at", { withTimezone: true }),
    playCount: integer("play_count").notNull().default(0),
    // self-FK; on delete set null (originals have null). Defined in the table
    // extras below via foreignKey() so we can name it and self-reference cleanly.
    remixedFrom: uuid("remixed_from"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("projects_user_id_idx").on(t.userId),
    uniqueIndex("projects_user_slug_uidx").on(t.userId, t.slug),
    // Partial unique index: only published rows (the public play route's hot path).
    uniqueIndex("projects_published_slug_uidx")
      .on(t.slug)
      .where(sql`is_published`),
    // Partial index for "remixes of this game" lineage queries.
    index("projects_remixed_from_idx")
      .on(t.remixedFrom)
      .where(sql`remixed_from is not null`),
    // Self-referencing FK: projects.remixed_from → projects.id, on delete set null.
    foreignKey({
      columns: [t.remixedFrom],
      foreignColumns: [t.id],
      name: "projects_remixed_from_fkey",
    }).onDelete("set null"),
  ],
);

// =============================================================================
// public.conversations — owned by a project + user (user_id denormalised for RLS).
// =============================================================================
export const conversations = pgTable(
  "conversations",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => authUsers.id, { onDelete: "cascade" }),
    title: text("title"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("conversations_project_id_idx").on(t.projectId),
    index("conversations_user_id_idx").on(t.userId),
  ],
);

// =============================================================================
// public.messages — `events jsonb` holds streamed tool/agent events; `position`
// orders within a conversation. Scoped via the owning conversation (RLS).
// =============================================================================
export const messages = pgTable(
  "messages",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    conversationId: uuid("conversation_id")
      .notNull()
      .references(() => conversations.id, { onDelete: "cascade" }),
    role: text("role").notNull(),
    content: text("content"),
    events: jsonb("events"),
    position: integer("position").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("messages_conversation_id_idx").on(t.conversationId),
    check(
      "messages_role_check",
      sql`${t.role} in ('user', 'assistant', 'system', 'tool')`,
    ),
  ],
);

// =============================================================================
// public.runs — per-build metering (tokens/images/sandbox_ms/credits_spent).
// =============================================================================
export const runs = pgTable(
  "runs",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => authUsers.id, { onDelete: "cascade" }),
    status: text("status").notNull().default("pending"),
    model: text("model"),
    inputTokens: integer("input_tokens").notNull().default(0),
    outputTokens: integer("output_tokens").notNull().default(0),
    images: integer("images").notNull().default(0),
    sandboxMs: integer("sandbox_ms").notNull().default(0),
    creditsSpent: integer("credits_spent").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("runs_project_id_idx").on(t.projectId),
    index("runs_user_id_idx").on(t.userId),
    check(
      "runs_status_check",
      sql`${t.status} in ('pending', 'running', 'succeeded', 'failed', 'canceled')`,
    ),
  ],
);

// =============================================================================
// public.credit_ledger — append-only source of truth for the balance. `delta`
// positive for grants/top-ups, negative for spend. Optional refs to a run /
// payment. (FK to payment_orders is declared in the table extras below.)
// =============================================================================
export const creditLedger = pgTable(
  "credit_ledger",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    userId: uuid("user_id")
      .notNull()
      .references(() => authUsers.id, { onDelete: "cascade" }),
    delta: integer("delta").notNull(),
    reason: text("reason").notNull(),
    runId: uuid("run_id").references(() => runs.id, { onDelete: "set null" }),
    paymentId: uuid("payment_id"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("credit_ledger_user_id_idx").on(t.userId),
    // Deferred FK in the original SQL: credit_ledger.payment_id → payment_orders.id
    // on delete set null. Named to match the original constraint name.
    foreignKey({
      columns: [t.paymentId],
      foreignColumns: [paymentOrders.id],
      name: "credit_ledger_payment_id_fkey",
    }).onDelete("set null"),
  ],
);

// =============================================================================
// public.payment_orders — SePay (VietQR) / Stripe top-ups. `transfer_code` is
// the unique code in the bank transfer; `sepay_txn_id` makes the webhook
// idempotent (both UNIQUE).
// =============================================================================
export const paymentOrders = pgTable(
  "payment_orders",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    userId: uuid("user_id")
      .notNull()
      .references(() => authUsers.id, { onDelete: "cascade" }),
    provider: text("provider").notNull().default("sepay"),
    transferCode: text("transfer_code").notNull().unique(),
    amountVnd: integer("amount_vnd").notNull(),
    creditsGranted: integer("credits_granted").notNull(),
    status: text("status").notNull().default("pending"),
    sepayTxnId: text("sepay_txn_id").unique(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("payment_orders_user_id_idx").on(t.userId),
    // P3 housekeeping indexes (0003_payments.sql).
    index("payment_orders_pending_created_idx")
      .on(t.createdAt)
      .where(sql`status = 'pending'`),
    index("payment_orders_user_created_idx").on(t.userId, t.createdAt.desc()),
    check(
      "payment_orders_provider_check",
      sql`${t.provider} in ('sepay', 'stripe')`,
    ),
    check(
      "payment_orders_status_check",
      sql`${t.status} in ('pending', 'paid', 'expired')`,
    ),
  ],
);
