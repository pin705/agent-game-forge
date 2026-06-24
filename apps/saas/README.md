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

### b) Run the database migration

Apply `supabase/migrations/0001_init.sql` (tables, RLS on every table, and the
signup trigger that creates a profile + grants 50 free credits). Either:

- **SQL editor (simplest):** Supabase dashboard → **SQL Editor** → paste the
  contents of `supabase/migrations/0001_init.sql` → **Run**. (It's safe to
  re-run.)
- **CLI:** with the [Supabase CLI](https://supabase.com/docs/guides/cli) linked
  to your project:
  ```bash
  supabase db push
  ```

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
Supabase + RLS, signup trigger granting free credits, DB migration for the full
§4 data model. **Stubbed for P1+:** the agent build loop (DeepSeek) + sandbox,
live preview, cloud file tree/editor (R2), credit metering/ledger writes (P2),
and SePay/Stripe payments (P3). OAuth (Google/GitHub) buttons are present but
disabled until providers are configured in Supabase.
