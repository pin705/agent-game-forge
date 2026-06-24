/**
 * Monorepo React-version dedupe shim (P0).
 *
 * Why this exists
 * ---------------
 * The sibling apps (apps/studio, apps/web) pin **React 18**, so npm hoists a
 * React 18 copy to the repo-root `node_modules`. This app pins **React 19**
 * (nested under apps/saas/node_modules). npm also hoists Next's runtime helper
 * `styled-jsx` to the repo root, where it resolves the root **React 18** at
 * plain Node `require()` time.
 *
 * Next's Pages-Router server runtime (`_document`, `/_error`, `/404`, `/500`)
 * loads that hoisted `styled-jsx`, pulling React 18 into the same process that
 * App Router renders with React 19. Two React instances → the renderer's
 * dispatcher is null → `TypeError: Cannot read properties of null (reading
 * 'useContext')` during `next build`'s static-generation step.
 *
 * The webpack `react` alias does NOT fix this: the failing `require('react')`
 * happens in Next's *precompiled* server bundle at runtime, not in app code
 * webpack controls. npm `overrides` can't fix it without forcing every
 * workspace onto one React version (which would break the React-18 apps), and
 * npm has no per-package "nohoist".
 *
 * The fix: give THIS workspace its own copy of `styled-jsx` (and react-is,
 * which it imports) under apps/saas/node_modules, so Node resolves them
 * against React 19 — never the root React 18. Idempotent; safe to re-run; only
 * touches apps/saas/node_modules (never the siblings or the root).
 */
import { cpSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const appRoot = join(__dirname, ".."); // apps/saas
const localNodeModules = join(appRoot, "node_modules");

const require = createRequire(import.meta.url);

/** Resolve the on-disk dir of a package as seen from THIS workspace. */
function pkgDir(name) {
  try {
    return dirname(require.resolve(`${name}/package.json`, { paths: [appRoot] }));
  } catch {
    return null;
  }
}

/** Major version a package's nearest `react` resolves to (or null). */
function reactMajorFrom(fromDir) {
  try {
    const p = require.resolve("react/package.json", { paths: [fromDir] });
    return parseInt(JSON.parse(readFileSync(p, "utf8")).version, 10);
  } catch {
    return null;
  }
}

const localReactMajor = reactMajorFrom(appRoot);
if (localReactMajor == null) {
  // Deps not installed yet (e.g. install ordering) — nothing to do.
  process.exit(0);
}

// Packages that (a) `require('react')` at runtime and (b) tend to hoist to the
// repo root next to a different React. Copy each one that is NOT already bound
// to the local React major into apps/saas/node_modules.
const TO_LOCALIZE = ["styled-jsx", "react-is"];

let changed = false;
for (const name of TO_LOCALIZE) {
  const localCopy = join(localNodeModules, name);
  if (existsSync(localCopy) && reactMajorFrom(localCopy) === localReactMajor) {
    continue; // already correct
  }
  const src = pkgDir(name);
  if (!src) continue; // not present in the tree; skip
  if (reactMajorFrom(src) === localReactMajor && src.startsWith(localNodeModules)) {
    continue; // hoisted copy already binds the right React and is local
  }
  mkdirSync(localNodeModules, { recursive: true });
  cpSync(src, localCopy, { recursive: true, dereference: true });
  changed = true;
  console.log(`[fix-react-dedupe] localized ${name} → React ${localReactMajor}`);
}

if (!changed) {
  console.log("[fix-react-dedupe] React resolution already consistent — no changes.");
}
