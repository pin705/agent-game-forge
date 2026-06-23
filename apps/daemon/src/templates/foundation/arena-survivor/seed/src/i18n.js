// i18n.js — tiny localization layer (vanilla, zero deps). Load BEFORE render/hud.
// Strings live in data/strings.json as { "en": {...}, "vi": {...} } so they are
// editor- and data-driven (same philosophy as every other data/*.json). The active
// locale DEFAULTS TO THE USER'S BROWSER LANGUAGE (navigator.language) — a Vietnamese
// player gets Vietnamese automatically — with ?lang= and a saved choice as overrides.
//
// Usage:  await loadStrings();  // in boot(), before first render
//         crispText(ctx, t("title"), ...)        // simple
//         t("kills", { n: state.killCount })      // with {n} interpolation
//         setLocale("vi")                          // manual switch (persists)

var I18N = { locale: "en", strings: {}, ready: false };

function detectLocale() {
  var nav = (typeof navigator !== "undefined" && (navigator.language || (navigator.languages || [])[0])) || "en";
  var l = String(nav).toLowerCase();
  if (l.indexOf("vi") === 0) return "vi";       // vi, vi-VN → Vietnamese
  return "en";                                    // default English for everything else
}

function applyLocaleOverrides() {
  // ?lang=vi wins (shareable), else a previously saved choice, else browser language.
  try {
    var q = new URLSearchParams(location.search).get("lang");
    if (q && I18N.strings[q]) { I18N.locale = q; return; }
  } catch (e) {}
  try {
    var saved = localStorage.getItem("ogf_lang");
    if (saved && I18N.strings[saved]) { I18N.locale = saved; return; }
  } catch (e) {}
  I18N.locale = detectLocale();
  if (!I18N.strings[I18N.locale]) I18N.locale = "en";
}

async function loadStrings(path) {
  path = path || "data/strings.json";
  try {
    var res = await fetch(path, { cache: "no-cache" });
    if (res.ok) I18N.strings = await res.json();
  } catch (e) {
    // No strings file → t() returns keys/fallbacks; game still runs.
    I18N.strings = I18N.strings || {};
  }
  applyLocaleOverrides();
  I18N.ready = true;
}

function setLocale(loc) {
  I18N.locale = I18N.strings[loc] ? loc : "en";
  try { localStorage.setItem("ogf_lang", I18N.locale); } catch (e) {}
}

function currentLocale() { return I18N.locale; }

// t(key) → active-locale string, falling back to English, then the raw key.
// Optional vars object does {placeholder} interpolation.
function t(key, vars) {
  var tbl = I18N.strings[I18N.locale] || {};
  var en = I18N.strings.en || {};
  var s = (tbl[key] != null) ? tbl[key] : (en[key] != null ? en[key] : key);
  if (vars) {
    for (var k in vars) {
      if (Object.prototype.hasOwnProperty.call(vars, k)) {
        s = String(s).split("{" + k + "}").join(String(vars[k]));
      }
    }
  }
  return s;
}
