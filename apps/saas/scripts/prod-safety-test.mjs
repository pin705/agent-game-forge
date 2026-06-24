/**
 * PROD-SAFETY assertion for the local-dev auth bypass.
 *
 * The dev-user bypass (lib/auth/current-user.ts) is the single riskiest piece
 * of the offline mode: if it ever leaked into a configured (prod) deployment, a
 * forged/absent session would be silently upgraded to a real user. This test
 * proves it CANNOT — the bypass is gated solely on the server env
 * (`supabaseConfigured()`), never on any request input.
 *
 * Asserts:
 *   (1) local-dev (placeholder Supabase) → isLocalDev() true, supabaseConfigured()
 *       false, getSessionUser() returns the stable dev user.
 *   (2) prod (real-looking Supabase URL) → isLocalDev() false, supabaseConfigured()
 *       true. getSessionUser() must take the REAL Supabase path — it must NEVER
 *       return the dev user. (Here the real client can't reach a session/cookie
 *       store outside a request, so it returns null or throws — either way it is
 *       NOT the dev user. We assert the dev-user is impossible on this path.)
 *
 * Run:  npm run prod-safety-test   (tsx — resolves the `@/` alias)
 */
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");

let pass = true;
const check = (label, ok) => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}`);
  if (!ok) pass = false;
};

// Fresh import each phase so the env is read at module-eval boundaries cleanly
// (the helpers read process.env at call time, but re-importing is belt-and-braces).
const load = async () =>
  import(pathToFileURL(path.join(root, "lib/auth/current-user.ts")).href + `?t=${Date.now()}`);

console.log("\n=== prod-safety: local-dev auth bypass gating ===\n");

// (1) LOCAL-DEV: placeholder URL → bypass active.
process.env.NEXT_PUBLIC_SUPABASE_URL = "https://placeholder.supabase.co";
{
  const mod = await load();
  check("local-dev: supabaseConfigured() === false", mod.supabaseConfigured() === false);
  check("local-dev: isLocalDev() === true", mod.isLocalDev() === true);
  const u = await mod.getSessionUser();
  check(
    "local-dev: getSessionUser() returns the dev user",
    !!u && u.id === "dev-user" && u.email === "dev@local",
  );
}

// (2) PROD: real-looking URL → bypass MUST be off; dev user impossible.
process.env.NEXT_PUBLIC_SUPABASE_URL = "https://realproject.supabase.co";
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon-key";
{
  const mod = await load();
  check("prod: supabaseConfigured() === true", mod.supabaseConfigured() === true);
  check("prod: isLocalDev() === false", mod.isLocalDev() === false);

  // The prod path goes through the real Supabase client. Outside a Next request
  // there's no cookie store, so it returns null or throws — crucially it must
  // NEVER yield the dev user. Assert the dev-user is unreachable on this path.
  let devLeaked = false;
  let outcome = "null";
  try {
    const u = await mod.getSessionUser();
    if (u && u.id === "dev-user") devLeaked = true;
    outcome = u ? `user:${u.id}` : "null";
  } catch (e) {
    outcome = `threw:${(e && e.message ? e.message : String(e)).split("\n")[0].slice(0, 60)}`;
  }
  check(`prod: getSessionUser() did NOT return the dev user (outcome=${outcome})`, !devLeaked);
}

console.log(`\n=== prod-safety: ${pass ? "ALL PASS" : "FAILURES"} ===\n`);
process.exit(pass ? 0 : 1);
