// =============================================================================
// drizzle-kit config — schema & migrations for the Footage SaaS Postgres DB.
//
// Flow for the user:
//   1. Set DATABASE_URL (Supabase → Project Settings → Database → Connection
//      string → Session pooler OR Direct connection, port 5432; NOT the
//      transaction pooler, which can choke on migration DDL). See .env.example.
//   2. `npm run db:migrate -w @ogf/saas`  → applies drizzle/*.sql in order.
//
// `db:generate` (drizzle-kit generate) is OFFLINE and needs no DATABASE_URL.
//
// schemaFilter: ['public'] — drizzle-kit ONLY manages the `public` schema. It
// will never try to create/alter/drop Supabase's managed `auth` / `storage`
// schemas, even though lib/db/schema.ts references `auth.users(id)` for FKs.
// =============================================================================

import { defineConfig } from "drizzle-kit";

export default defineConfig({
  schema: "./lib/db/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL!,
  },
  // Only manage the public schema; leave Supabase's auth/storage schemas alone.
  schemaFilter: ["public"],
  // Keep generated SQL stable & readable.
  verbose: true,
  strict: true,
});
