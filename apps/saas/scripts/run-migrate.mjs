// Run drizzle's migrator directly (same as `drizzle-kit migrate`) but WITHOUT
// the spinner that swallows the Postgres error. Prints the full error so we can
// see exactly which statement fails. On success the DB is migrated.
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { readFileSync } from "node:fs";

const env = readFileSync(new URL("../.env", import.meta.url), "utf8");
const url = env.match(/^DATABASE_URL=(.*)$/m)?.[1]?.trim();
if (!url) throw new Error("no DATABASE_URL in .env");

const sql = postgres(url, { max: 1, connect_timeout: 20 });
const db = drizzle(sql);

try {
  await migrate(db, { migrationsFolder: new URL("../drizzle", import.meta.url).pathname });
  console.log("✅ MIGRATE OK");
} catch (e) {
  console.error("❌ MIGRATE FAILED:");
  console.error("message:", e?.message);
  if (e?.severity) console.error("severity:", e.severity);
  if (e?.code) console.error("code:", e.code);
  if (e?.detail) console.error("detail:", e.detail);
  if (e?.hint) console.error("hint:", e.hint);
  if (e?.where) console.error("where:", e.where);
  if (e?.query) console.error("query:", String(e.query).slice(0, 400));
  if (e?.position) console.error("position:", e.position);
  process.exitCode = 1;
} finally {
  await sql.end({ timeout: 5 });
}
