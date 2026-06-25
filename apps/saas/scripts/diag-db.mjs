// Throwaway DB diagnostic: connect via DATABASE_URL (from .env), report the
// current public-schema state + drizzle journal so we can see exactly where
// `drizzle-kit migrate` is failing (its spinner swallows the real error).
import postgres from "postgres";
import { readFileSync } from "node:fs";

const env = readFileSync(new URL("../.env", import.meta.url), "utf8");
const m = env.match(/^DATABASE_URL=(.*)$/m);
if (!m) throw new Error("no DATABASE_URL in .env");
const url = m[1].trim();

const sql = postgres(url, { max: 1, idle_timeout: 5, connect_timeout: 15 });

try {
  const tables = await sql`
    select table_name from information_schema.tables
    where table_schema = 'public' order by 1`;
  console.log("PUBLIC TABLES:", tables.map((t) => t.table_name));

  const funcs = await sql`
    select proname from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' order by 1`;
  console.log("PUBLIC FUNCTIONS:", funcs.map((f) => f.proname));

  let journal;
  try {
    journal = await sql`select id, hash, created_at from drizzle."__drizzle_migrations" order by created_at`;
    console.log("DRIZZLE JOURNAL rows:", journal.length);
    for (const r of journal) console.log("  applied:", r.created_at, String(r.hash).slice(0, 16));
  } catch (e) {
    console.log("DRIZZLE JOURNAL: <none/err>", e.message);
  }

  // Try the very first thing 0000 would do that could conflict: does a known
  // table already exist? Report which of our 7 exist.
  const ours = ["profiles", "projects", "conversations", "messages", "runs", "credit_ledger", "payment_orders"];
  const present = tables.map((t) => t.table_name);
  console.log("OUR TABLES present:", ours.filter((t) => present.includes(t)));
  console.log("OUR TABLES missing:", ours.filter((t) => !present.includes(t)));
} finally {
  await sql.end({ timeout: 5 });
}
