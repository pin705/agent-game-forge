# @ogf/saas — Footage (P0: Next shell + Auth)

The hosted SaaS replatform of the studio. **P0** delivers the Next.js (App
Router) shell, Supabase Auth, and Supabase-backed projects CRUD. There is **no
agent loop, sandbox, metering, or payments yet** — those are P1–P3 (see
`SAAS_ARCHITECTURE.md` §8).

Stack: **Next.js (App Router) + TypeScript + Tailwind v4 + Supabase Auth**.
Theme + shadcn primitives are ported verbatim from `apps/studio` (warm-paper /
mono-ink), so it looks identical.

## Prerequisites

- Node ≥ 20 (repo uses v22).
- Dependencies are installed from the **monorepo root** (`npm install`), not
  per-app.

## Setup

### a) Create a Supabase project

1. Go to <https://supabase.com> → **New project**.
2. Once it provisions, open **Project Settings → API** and copy:
   - **Project URL** → `NEXT_PUBLIC_SUPABASE_URL`
   - **anon public** key → `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - **service_role** key → `SUPABASE_SERVICE_ROLE_KEY` (server-only secret)

### b) Run the database migration (ONE command)

The schema (7 tables + RLS on every table + the three SECURITY DEFINER credit
functions + the signup trigger that creates a profile and grants 50 free
credits) is now managed by **Drizzle** (`lib/db/schema.ts` + `drizzle/`). Set up
the whole database with a single command — **no pasting SQL into the dashboard.**

1. Get your Postgres **connection string**: Supabase dashboard → **Project
   Settings → Database → Connection string** → pick **Session pooler** *or*
   **Direct connection** (port **5432**). Do **not** use the *Transaction
   pooler* (6543) — it can choke on migration DDL. It looks like:
   ```
   postgresql://postgres:[YOUR-DB-PASSWORD]@db.[PROJECT-REF].supabase.co:5432/postgres
   ```
2. Put it in `.env.local` as `DATABASE_URL` (see `.env.example`; this is the
   connection string, **not** the REST URL / anon key, and it's a server-only
   secret — never commit it).
3. Run the migrations from the monorepo root:
   ```bash
   npm run db:migrate -w @ogf/saas
   ```

That's it. It applies every file in `drizzle/` in order:
`0000_*.sql` (tables + indexes + FKs + checks) then `0001_rls_and_functions.sql`
(RLS enable + all policies + `set_updated_at`/`handle_new_user` triggers +
`record_run_charge`/`grant_credits`/`increment_play_count` functions). The
migrations are idempotent, so re-running is safe.

Other Drizzle scripts (all `-w @ogf/saas`):

- `npm run db:generate` — regenerate the table migration from `lib/db/schema.ts`
  after you change the schema. Runs **offline** (no `DATABASE_URL` needed).
- `npm run db:push` — push the schema straight to the DB without writing a
  migration file (quick dev sync; needs `DATABASE_URL`).
- `npm run db:studio` — open Drizzle Studio against `DATABASE_URL`.

> **Legacy SQL (reference only).** The hand-written `supabase/migrations/*.sql`
> and `supabase/setup-all.sql` are kept for reference and document the exact same
> schema, but Drizzle is now **canonical** — apply the DB with `db:migrate`, not
> by pasting those files. (You *can* still paste `setup-all.sql` into the SQL
> editor if you prefer the no-connection-string route; both produce the same
> schema, RLS, functions, and trigger.)

> Email confirmation: by default Supabase requires email confirmation on signup.
> For local testing you can disable it under **Authentication → Providers →
> Email**, or just use the magic-link flow.

### c) Fill `.env.local`

A `.env.local` with **placeholder** values ships so the project builds offline.
Replace the placeholders with your real values (or copy from `.env.example`):

```
NEXT_PUBLIC_SUPABASE_URL=https://<your-project>.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=<anon-key>
SUPABASE_SERVICE_ROLE_KEY=<service-role-key>
# Only needed to RUN MIGRATIONS (db:migrate) — see step (b). Not read at runtime.
DATABASE_URL=postgresql://postgres:<db-password>@db.<project-ref>.supabase.co:5432/postgres
```

### d) Run the dev server

From the monorepo root:

```bash
npm install                  # once, installs all workspaces
npm -w @ogf/saas run dev     # http://localhost:7640
```

Or from this directory: `npm run dev`. Open <http://localhost:7640>.

To verify a production build: `npm -w @ogf/saas run build`.

> **Monorepo React note.** This app runs **React 19** while the sibling
> apps (`apps/studio`, `apps/web`) pin **React 18**. A tiny pre-step
> (`scripts/fix-react-dedupe.mjs`, wired to `predev`/`prebuild`/`postinstall`)
> keeps Next's `styled-jsx` bound to React 19 so `next build` doesn't hit a
> dual-React error. It's a no-op when npm already hoists React 19 — no action
> needed from you. It only ever writes inside `apps/saas/node_modules`.

## What works

- Sign up / log in with **email + password** or **magic link**; sign-out.
- Auth-guarded app: middleware refreshes the session and redirects
  unauthenticated users to `/login`.
- **Dashboard** lists your projects and a **New game** action creates a project
  row (name / slug / R2 prefix) scoped to you, then opens its builder.
- **Builder** (`/build/[id]`) renders the 3-column editor shell (chat / preview
  / code) as labelled placeholders.

## P0 status / stubbed for later

**Done (P0):** Next App Router shell, Supabase Auth (email+password + magic
link), middleware route protection, ported theme + shadcn UI, projects CRUD on
Supabase + RLS, signup trigger granting free credits, Drizzle-managed DB schema
+ migrations for the full §4 data model (`npm run db:migrate`). **Stubbed for P1+:** the agent build loop (DeepSeek) + sandbox,
live preview, cloud file tree/editor (R2), credit metering/ledger writes (P2),
and SePay/Stripe payments (P3). OAuth (Google/GitHub) buttons are present but
disabled until providers are configured in Supabase.
