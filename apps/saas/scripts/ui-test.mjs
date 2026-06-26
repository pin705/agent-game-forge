// Batch-4 chrome pure-logic checks: theme class resolution, command-list
// filtering, default-model persistence validation, and the theme inline script.
// Run with `npm run ui-test`. No DOM, no network — pure functions only.

import assert from "node:assert/strict";

// tsx is the runner (see package.json); import the TS sources directly.
const { resolveThemeClass, isThemePref, themeScript, THEME_LS_KEY } = await import(
  "../lib/theme.tsx"
);
const { filterCommands } = await import("../lib/command-palette.tsx");
const { resolveDefaultModel, fallbackModelId } = await import("../lib/prefs.ts");

let pass = 0;
const ok = (name) => {
  pass += 1;
  console.log(`  ok ${name}`);
};

// ── Theme resolution ───────────────────────────────────────────────────────
assert.equal(resolveThemeClass("light", true), "light", "explicit light ignores OS");
assert.equal(resolveThemeClass("dark", false), "dark", "explicit dark ignores OS");
assert.equal(resolveThemeClass("system", true), "dark", "system follows OS (dark)");
assert.equal(resolveThemeClass("system", false), "light", "system follows OS (light)");
ok("resolveThemeClass: light/dark/system");

assert.equal(isThemePref("system"), true);
assert.equal(isThemePref("dark"), true);
assert.equal(isThemePref("sepia"), false);
assert.equal(isThemePref(null), false);
ok("isThemePref guards bad values");

// The inline script must reference the same storage key and be self-contained.
assert.ok(themeScript.includes(JSON.stringify(THEME_LS_KEY)), "script uses THEME_LS_KEY");
assert.ok(themeScript.includes("prefers-color-scheme"), "script reads OS preference");
assert.ok(themeScript.includes("classList.toggle"), "script toggles .dark class");
ok("themeScript is consistent + self-contained");

// ── Command filtering ────────────────────────────────────────────────────
const cmds = [
  { id: "a", group: "navigate", label: "Go to dashboard", run() {} },
  { id: "b", group: "navigate", label: "Go to gallery", run() {} },
  { id: "c", group: "files", label: "Open file: index.html", keywords: "src/index.html", run() {} },
  { id: "d", group: "preferences", label: "Toggle theme", run() {} },
];
assert.equal(filterCommands(cmds, "").length, 4, "empty query returns all");
assert.deepEqual(
  filterCommands(cmds, "gall").map((c) => c.id),
  ["b"],
  "matches label substring",
);
assert.deepEqual(
  filterCommands(cmds, "src/index").map((c) => c.id),
  ["c"],
  "matches keywords (file path) not just label",
);
assert.equal(filterCommands(cmds, "  THEME ").length, 1, "trims + case-insensitive");
assert.equal(filterCommands(cmds, "zzz").length, 0, "no match → empty");
ok("filterCommands: label + keywords, trim, case-insensitive");

// ── Default-model persistence validation ───────────────────────────────────
const fallback = fallbackModelId();
assert.equal(resolveDefaultModel("deepseek-v4-pro"), "deepseek-v4-pro", "valid enabled id kept");
assert.equal(resolveDefaultModel("premium-claude"), fallback, "disabled id rejected → fallback");
assert.equal(resolveDefaultModel("nonsense"), fallback, "unknown id → fallback");
assert.equal(resolveDefaultModel(null), fallback, "null → fallback");
ok("resolveDefaultModel only accepts enabled catalog ids");

console.log(`\nui-test: ${pass} checks passed`);
