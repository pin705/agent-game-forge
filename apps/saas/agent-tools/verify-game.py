#!/usr/bin/env python3
"""verify-game — static pre-flight check for an OGF web game.

Why this exists:
  OpenGame's "debug skill" runs the game and fixes integration errors. In the
  OGF chassis the agent is headless and MUST NOT spawn a browser (see
  conventions/common.md "Phase verification"). This is the chassis-correct
  distillation: catch the common breakages STATICALLY, before the user opens
  the Play tab — the same error classes OpenGame's debug loop targets
  (missing assets, broken JSON, bad references, syntax errors), minus the
  browser.

  Run it at the end of a phase:  python .agents/tools/verify-game.py
  Exit 0 = clean (or warnings only). Exit 1 = errors that would break Play.

Checks:
  1. JS syntax       — `node --check` on every src/**/*.js (skipped if no node)
  2. JSON valid      — every data/**/*.json parses
  3. OGF level schema— level files have mapSize + a renderable field; array
                       entries carry `id` (warns; loader auto-injects)
  4. Asset paths     — every assets/... path referenced in data/ exists on disk
  5. index.html refs — every <script src> / <link href> local file exists

Debug protocol (OpenGame's self-improving fix-loop, browser-free):
  matched errors print a KNOWN FIX from a seed knowledge base; the seed is
  written to .ogf/debug-protocol.json so the agent can append learnings
  (`record`) and consult runtime gotchas the static pass can't see (`gotchas`).

Usage:
  python verify-game.py            # verify (default)
  python verify-game.py gotchas    # print runtime gotchas + known fixes
  python verify-game.py record --signature "<err substring>" --fix "<fix>" [--cause "..."]
"""

from __future__ import annotations

import argparse
import json
import re
import shutil
import subprocess
import sys
from pathlib import Path

ROOT = Path.cwd()
ERRORS: list = []
WARNINGS: list = []
OKS: list = []


def err(msg):
    ERRORS.append(msg)


def warn(msg):
    WARNINGS.append(msg)


def ok(msg):
    OKS.append(msg)


def rel(p: Path) -> str:
    try:
        return str(p.relative_to(ROOT))
    except ValueError:
        return str(p)


def check_js():
    files = sorted(ROOT.glob("src/**/*.js"))
    if not files:
        return
    node = shutil.which("node")
    if not node:
        warn("node not found on PATH — skipped JS syntax check")
        return
    bad = 0
    for f in files:
        r = subprocess.run([node, "--check", str(f)], capture_output=True, text=True)
        if r.returncode != 0:
            bad += 1
            msg = (r.stderr or r.stdout).strip().splitlines()
            err(f"JS syntax error in {rel(f)}: {msg[0] if msg else '(unknown)'}")
    if not bad:
        ok(f"JS syntax: {len(files)} file(s) parse")


def iter_json():
    for f in sorted(ROOT.glob("data/**/*.json")):
        try:
            yield f, json.loads(f.read_text(encoding="utf-8"))
        except json.JSONDecodeError as e:
            err(f"invalid JSON {rel(f)}: {e}")
            yield f, None


ID_ARRAYS = ("props", "platforms", "pickups", "colliders", "zones", "paths",
             "enemies", "hazards", "checkpoints", "spawn_points", "npcs",
             "blockers", "walkBounds", "walkable",
             # grid-logic / tower-defense / ui-heavy catalogs:
             "entities", "towers", "waves", "buildSpots", "cards", "nodes")
ASSET_RE = re.compile(r'(assets/[^"\s\\]+\.(?:png|jpg|jpeg|gif|ogg|wav|mp3|json))')
# Code → file refs: JS string literals like loadJSON("data/enemies.json") or
# "assets/x.png" that must exist on disk (else a runtime 404 breaks boot).
CODE_REF_RE = re.compile(
    r'''["'](data/[^"'\\\s]+\.json|assets/[^"'\\\s]+\.(?:png|jpg|jpeg|gif|ogg|wav|mp3|json))["']'''
)


def collect_strings(obj, out):
    if isinstance(obj, str):
        out.append(obj)
    elif isinstance(obj, dict):
        for v in obj.values():
            collect_strings(v, out)
    elif isinstance(obj, list):
        for v in obj:
            collect_strings(v, out)


def check_json_and_assets():
    docs = list(iter_json())
    if not docs:
        warn("no data/*.json found")
    valid = 0
    asset_refs = set()
    for f, data in docs:
        if data is None:
            continue
        valid += 1
        # Level-schema check (only files that declare mapSize).
        if isinstance(data, dict) and "mapSize" in data:
            ms = data.get("mapSize") or {}
            if not (isinstance(ms.get("width"), (int, float)) and isinstance(ms.get("height"), (int, float))):
                err(f"{rel(f)}: mapSize must have numeric width+height")
            if not any(k in data for k in ("background", "layers", "props", "platforms", "grid", "cells")):
                err(f"{rel(f)}: level has no renderable field (background | layers | props | platforms | grid) — Scene editor/Play will be empty")
            for key in ID_ARRAYS:
                for i, e in enumerate(data.get(key, []) or []):
                    if isinstance(e, dict) and "id" not in e:
                        warn(f"{rel(f)}: {key}[{i}] missing 'id' (editor needs it; loader will auto-inject)")
        strings = []
        collect_strings(data, strings)
        for s in strings:
            for m in ASSET_RE.findall(s):
                asset_refs.add(m)
    if valid:
        ok(f"JSON: {valid} file(s) valid")
    # Asset existence.
    missing = sorted(p for p in asset_refs if not (ROOT / p).is_file())
    if missing:
        for p in missing:
            err(f"asset referenced but missing on disk: {p}")
    elif asset_refs:
        ok(f"asset paths: {len(asset_refs)} reference(s) all resolve")


def check_index():
    idx = ROOT / "index.html"
    if not idx.is_file():
        warn("no index.html at project root")
        return
    html = idx.read_text(encoding="utf-8", errors="replace")
    refs = re.findall(r'<script[^>]+src="([^"]+)"', html) + re.findall(r'<link[^>]+href="([^"]+)"', html)
    miss = 0
    for r in refs:
        if r.startswith(("http://", "https://", "//", "data:")):
            continue
        if not (ROOT / r).is_file():
            miss += 1
            err(f"index.html references missing local file: {r}")
    if not miss and refs:
        ok(f"index.html: {len(refs)} local ref(s) resolve")


def check_code_refs():
    """Every data/*.json + assets/* path referenced from JS code must exist on
    disk — a missing one 404s at runtime and breaks boot (the #1 'built but won't
    play' bug, e.g. catalogs.js loads data/enemies.json that was never written).
    Catches refs the data→asset + index→script checks don't see."""
    refs = set()
    for f in ROOT.glob("**/*.js"):
        if any(part in ("node_modules", "agent-tools", ".agents") for part in f.parts):
            continue
        try:
            txt = f.read_text(encoding="utf-8", errors="ignore")
        except Exception:
            continue
        for m in CODE_REF_RE.findall(txt):
            refs.add(m)
    missing = sorted(p for p in refs if not (ROOT / p).is_file())
    if missing:
        for p in missing:
            err(f"code references a file missing on disk: {p} (404 at runtime -> boot fails)")
    elif refs:
        ok(f"code refs: {len(refs)} data/asset reference(s) resolve")


# ── No-undef static check (catches ReferenceError before the browser) ───────
# A curated allowlist of JS / browser / DOM / timer / typed-array globals. We are
# DELIBERATELY generous here — a false positive (flagging a real global) is worse
# than a miss (the browser QA gate catches the rest). If a called name isn't here
# and isn't declared/imported ANYWHERE in the project, it's a ReferenceError.
JS_GLOBALS = {
    # core language
    "window", "document", "console", "globalThis", "self", "Math", "JSON",
    "Object", "Array", "Number", "String", "Boolean", "Symbol", "BigInt",
    "Function", "Promise", "Proxy", "Reflect", "Set", "WeakSet", "Map",
    "WeakMap", "Date", "RegExp", "Error", "TypeError", "RangeError",
    "SyntaxError", "ReferenceError", "EvalError", "URIError", "WeakRef",
    "parseInt", "parseFloat", "isNaN", "isFinite", "encodeURIComponent",
    "decodeURIComponent", "encodeURI", "decodeURI", "structuredClone", "eval",
    "queueMicrotask", "btoa", "atob", "escape", "unescape",
    # typed arrays + buffers
    "ArrayBuffer", "SharedArrayBuffer", "DataView", "Int8Array", "Uint8Array",
    "Uint8ClampedArray", "Int16Array", "Uint16Array", "Int32Array",
    "Uint32Array", "Float32Array", "Float64Array", "BigInt64Array",
    "BigUint64Array",
    # timers / animation
    "requestAnimationFrame", "cancelAnimationFrame", "requestIdleCallback",
    "cancelIdleCallback", "setTimeout", "setInterval", "clearTimeout",
    "clearInterval", "setImmediate",
    # network / data
    "fetch", "XMLHttpRequest", "Headers", "Request", "Response", "FormData",
    "URL", "URLSearchParams", "Blob", "File", "FileReader", "WebSocket",
    "EventSource", "AbortController", "AbortSignal", "TextEncoder",
    "TextDecoder", "ReadableStream", "WritableStream", "TransformStream",
    # media / canvas / audio / images
    "Image", "Audio", "AudioContext", "webkitAudioContext", "OfflineAudioContext",
    "ImageData", "ImageBitmap", "createImageBitmap", "Path2D", "OffscreenCanvas",
    "HTMLCanvasElement", "HTMLImageElement", "HTMLAudioElement",
    "HTMLElement", "HTMLVideoElement", "CanvasRenderingContext2D",
    "WebGLRenderingContext", "WebGL2RenderingContext",
    # DOM / events / observers
    "Element", "Node", "Event", "CustomEvent", "MouseEvent", "KeyboardEvent",
    "TouchEvent", "PointerEvent", "WheelEvent", "EventTarget", "DOMParser",
    "MutationObserver", "ResizeObserver", "IntersectionObserver",
    "getComputedStyle", "matchMedia", "DOMRect", "DOMMatrix",
    "DocumentFragment", "Text", "Range",
    # platform globals
    "navigator", "location", "history", "screen", "performance", "crypto",
    "localStorage", "sessionStorage", "indexedDB", "caches", "alert", "confirm",
    "prompt", "open", "close", "focus", "blur", "scrollTo", "scrollBy",
    "postMessage", "addEventListener", "removeEventListener", "dispatchEvent",
    "gamepad", "getGamepads", "speechSynthesis",
    # workers / modules
    "Worker", "SharedWorker", "importScripts", "import", "require", "module",
    "exports", "process",
    # JS keywords that the call-regex can pick up (defensive — also filtered below)
    "if", "for", "while", "switch", "catch", "function", "return", "typeof",
    "await", "new", "delete", "void", "in", "of", "do", "else", "case",
    "instanceof", "yield", "throw", "with", "super", "this",
}

# Statement keywords that precede a `(` but are NOT function calls.
CALL_KEYWORDS = {
    "if", "for", "while", "switch", "catch", "function", "return", "typeof",
    "await", "new", "delete", "void", "in", "of", "do", "else", "case",
    "instanceof", "yield", "throw", "with", "super", "constructor", "get",
    "set", "async", "static",
}

# A bare identifier call: not preceded by `.` (skip method calls) or `function`.
CALL_RE = re.compile(r'(?:^|[^.\w$])([A-Za-z_$][\w$]*)\s*\(')
# Declarations / bindings that introduce a name into the project's "known" set.
DECL_RES = [
    re.compile(r'\bfunction\s*\*?\s*([A-Za-z_$][\w$]*)'),          # function foo / function* foo
    re.compile(r'\bclass\s+([A-Za-z_$][\w$]*)'),                    # class Foo
    re.compile(r'\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)'),        # const/let/var foo
    re.compile(r'\bexport\s+(?:default\s+)?function\s*\*?\s*([A-Za-z_$][\w$]*)'),
    re.compile(r'\bexport\s+(?:default\s+)?class\s+([A-Za-z_$][\w$]*)'),
]
# import { a, b as c } from '...'  /  import Foo from '...'  /  import * as NS
IMPORT_NAMED_RE = re.compile(r'\bimport\s*(?:[\w$]+\s*,\s*)?\{([^}]*)\}')
IMPORT_DEFAULT_RE = re.compile(r'\bimport\s+([A-Za-z_$][\w$]*)\s*(?:,|from)')
IMPORT_STAR_RE = re.compile(r'\bimport\s*\*\s*as\s+([A-Za-z_$][\w$]*)')


def _strip_js(txt: str) -> str:
    """Remove comments + string/template literals so we don't pick up calls or
    names that only appear inside text. Conservative: leaves code intact."""
    # block comments
    txt = re.sub(r'/\*.*?\*/', ' ', txt, flags=re.DOTALL)
    # line comments
    txt = re.sub(r'//[^\n]*', ' ', txt)
    # string + template literals (no nesting handling needed for our coarse use)
    txt = re.sub(r'"(?:[^"\\]|\\.)*"', '""', txt)
    txt = re.sub(r"'(?:[^'\\]|\\.)*'", "''", txt)
    txt = re.sub(r'`(?:[^`\\]|\\.)*`', '``', txt)
    return txt


def _project_js_files():
    for f in ROOT.glob("**/*.js"):
        if any(part in ("node_modules", "agent-tools", ".agents", ".ogf") for part in f.parts):
            continue
        yield f


def check_undefined_refs():
    """HIGH-CONFIDENCE ReferenceError catch: a bare function identifier that is
    CALLED somewhere in the project's JS but DECLARED / EXPORTED / IMPORTED
    NOWHERE in the project AND is not a known JS/browser global → it throws
    `ReferenceError: <name> is not defined` the instant that code path runs, so
    the game shows "Boot failed".

    Conservative by design (low false-positive): we only flag a name defined
    NOWHERE in the project. A name that IS defined in some file but not imported
    into the calling file (a weaker, ESM-only signal) is NOT flagged here — the
    real-browser QA gate catches those. We also strip comments + string/template
    literals before scanning so text never produces a phantom call."""
    files = list(_project_js_files())
    if not files:
        return
    known = set()
    sources = []
    for f in files:
        try:
            raw = f.read_text(encoding="utf-8", errors="ignore")
        except OSError:
            continue
        code = _strip_js(raw)
        sources.append((f, code))
        for rx in DECL_RES:
            for m in rx.findall(code):
                known.add(m)
        for grp in IMPORT_NAMED_RE.findall(code):
            for piece in grp.split(","):
                piece = piece.strip()
                if not piece:
                    continue
                # `orig as alias` → the alias is the in-scope name
                name = piece.split(" as ")[-1].strip()
                if re.fullmatch(r'[A-Za-z_$][\w$]*', name):
                    known.add(name)
        for m in IMPORT_DEFAULT_RE.findall(code):
            known.add(m)
        for m in IMPORT_STAR_RE.findall(code):
            known.add(m)
    allowed = known | JS_GLOBALS
    flagged = {}  # name → first file it's called in
    for f, code in sources:
        for m in CALL_RE.finditer(code):
            name = m.group(1)
            if name in CALL_KEYWORDS or name in allowed:
                continue
            flagged.setdefault(name, f)
    for name in sorted(flagged):
        err(
            f"function '{name}' is called but defined nowhere "
            f"(ReferenceError at runtime — define it or import it) in {rel(flagged[name])}"
        )
    if not flagged and sources:
        ok(f"no-undef: {len(sources)} JS file(s), no undefined function calls")


# ── Debug protocol (OpenGame's Protocol P, browser-free) ────────────────────
# Seed knowledge base: error signature → root cause → verified fix. Static
# entries are matched against this run's errors and printed as "known fixes".
# Runtime entries are gotchas the static pass can't detect — the agent consults
# them (`gotchas`) when the USER reports a misbehaving-but-running game. The
# seed is written to .ogf/debug-protocol.json so the agent can `record` more.
PROTOCOL_FILE = ROOT / ".ogf" / "debug-protocol.json"
SEED_PROTOCOL = [
    {"id": "asset_missing", "kind": "static", "match": "asset referenced but missing",
     "cause": "data/*.json points at an assets/ path not on disk (typo, or never fetched/generated).",
     "fix": "Fetch it free: python .agents/tools/fetch-asset.py fetch \"<desc>\" <that exact path> --kind <kind>; or gen-image.py. The data path must match the file byte-for-byte."},
    {"id": "art_unwired", "kind": "static", "match": "empty/unwired animations but sprite art",
     "cause": "Art was fetched into assets/ but the entity's animations have no sprite wired, so it renders a fallback rectangle — the game looks unfinished ('phèn') despite having art.",
     "fix": "For EACH character/enemy/player animation add a real sprite + frame slicing, e.g. \"idle\": {\"sprite\": \"assets/sprites/<x>/sheet.png\", \"frames\": N, \"fw\": W, \"fh\": H, \"fps\": 8}. Slice the sheet (generate2dsprite skill / .ogf-slice.json sidecar). Never leave animations empty when sprite art exists."},
    {"id": "no_renderable", "kind": "static", "match": "no renderable field",
     "cause": "A level JSON has mapSize but nothing to draw — Play/Scene editor is empty.",
     "fix": "Add one of background | layers[] | props[] | platforms[]. Scrolling camera → layers[]."},
    {"id": "mapsize", "kind": "static", "match": "mapSize must have numeric",
     "cause": "Level missing numeric mapSize.width/height; Scene editor can't open it.",
     "fix": "Add \"mapSize\": { \"width\": <n>, \"height\": <n> } at top level."},
    {"id": "missing_id", "kind": "static", "match": "missing 'id'",
     "cause": "Scene editor addresses every array entry by id; without it, drag-edit save fails.",
     "fix": "Give every array entry a unique \"id\" string (e.g. coin_1, plat_2)."},
    {"id": "defined_nowhere", "kind": "static", "match": "is called but defined nowhere",
     "cause": "A function identifier is CALLED in the project's JS but is declared/exported/imported NOWHERE (e.g. buildEnemyInstance(...) with no `function buildEnemyInstance` or import) -> ReferenceError the instant that path runs -> 'Boot failed'.",
     "fix": "Define the function (write `function <name>(...)` or a const arrow), OR import it from the module that exports it, OR fix the typo to match the real name. Every bare call must resolve to a project declaration, an import, or a JS/browser global."},
    {"id": "code_ref_missing", "kind": "static", "match": "code references a file missing",
     "cause": "JS loads a data/*.json or assets/* path that was never created (e.g. catalogs.js loads data/enemies.json that doesn't exist) -> 404 -> boot fails.",
     "fix": "Create the missing file (write the data/*.json with real content, or fetch/gen the asset), OR remove the reference. Every loadJSON()/fetch() path the code uses MUST exist on disk."},
    {"id": "index_ref", "kind": "static", "match": "index.html references missing",
     "cause": "A <script src>/<link href> points at a file that doesn't exist.",
     "fix": "Create the file or fix the path. Script-tag mode load order: constants → state → subsystems → game.js last."},
    {"id": "bad_json", "kind": "static", "match": "invalid JSON",
     "cause": "A data file doesn't parse — usually a trailing comma, single quotes, or an unquoted key.",
     "fix": "JSON needs double-quoted keys/strings and no trailing commas. Validate the file."},
    {"id": "js_syntax", "kind": "static", "match": "JS syntax error",
     "cause": "A src/*.js file has a syntax error.",
     "fix": "node --check it. In script-tag (non-module) mode do NOT use import/export — declare globals."},
    {"id": "not_defined", "kind": "runtime", "match": "is not defined",
     "cause": "A global used before its <script> ran — wrong load order in index.html.",
     "fix": "Order scripts constants → state → config → subsystems → game.js. Don't use a module's globals before its tag loads."},
    {"id": "undef_prop", "kind": "runtime", "match": "Cannot read properties of undefined",
     "cause": "Reading a field off an object not loaded yet (asset/data not awaited) or a missing catalog id.",
     "fix": "await loadJSON/loadImage before use; guard catalog lookups; confirm the id exists in data/*.json."},
    {"id": "fetch_404", "kind": "runtime", "match": "404",
     "cause": "Opened via file://, or a data/asset path is wrong — fetch() can't load it.",
     "fix": "Serve over http (the Play tab does). Use paths relative to index.html."},
    {"id": "blank_canvas", "kind": "runtime", "match": "blank",
     "cause": "Runs but nothing draws: asset not wired into data, render not called, or draw before image loaded.",
     "fix": "Confirm the asset is referenced in data/*.json, renderFrame() runs each frame, images loaded before draw."},
]


def load_protocol() -> list:
    entries = list(SEED_PROTOCOL)
    if PROTOCOL_FILE.is_file():
        try:
            extra = json.loads(PROTOCOL_FILE.read_text(encoding="utf-8"))
            if isinstance(extra, list):
                seen = {e.get("id") for e in entries}
                entries += [e for e in extra if e.get("id") not in seen]
        except (json.JSONDecodeError, OSError):
            pass
    return entries


def ensure_protocol_seed() -> None:
    if not PROTOCOL_FILE.is_file():
        try:
            PROTOCOL_FILE.parent.mkdir(parents=True, exist_ok=True)
            PROTOCOL_FILE.write_text(json.dumps(SEED_PROTOCOL, indent=2) + "\n", encoding="utf-8")
        except OSError:
            pass


def check_start_scene():
    # Catch the "Boot failed: unknown scene" class STATICALLY: GAME.startScene
    # (src/constants.js) must have a matching level id in data/levels.json.
    # This is a runtime crash the other checks can't see — so check it here.
    import re
    levels_f = ROOT / "data" / "levels.json"
    if not levels_f.exists():
        return
    try:
        manifest = json.loads(levels_f.read_text(encoding="utf-8"))
    except Exception:
        return  # malformed JSON is reported by check_json_and_assets
    ids = [l.get("id") for l in manifest.get("levels", []) if isinstance(l, dict)]
    start = None
    for f in sorted(ROOT.glob("src/**/*.js")):
        m = re.search(r"""startScene\s*:\s*["']([^"']+)["']""", f.read_text(encoding="utf-8", errors="ignore"))
        if m:
            start = m.group(1)
            break
    if start is None:
        return  # no startScene declared (non-side-scroll runtime) — skip
    if not ids:
        err(f"startScene is '{start}' but data/levels.json has no levels — the game can't boot. Add a level whose id is '{start}'.")
    elif start not in ids:
        err(f"startScene '{start}' has no matching id in data/levels.json (have: {ids}) — boot fails with 'Unknown scene'.")
    else:
        ok(f"startScene '{start}' resolves to a level")


def check_juice():
    # Game-feel gate (advisory): once a project has real code, it should ship and
    # wire src/juice.js. Distilled from OpenGame's effects layer — see
    # conventions/juice.md. Warns only; never blocks the Play tab.
    files = sorted(ROOT.glob("src/**/*.js"))
    gameplay = [f for f in files if f.name != "juice.js"]
    if len(gameplay) < 3:
        return  # too early — bare scaffold, nothing to juice yet
    if not (ROOT / "src" / "juice.js").exists():
        warn("no src/juice.js — game-feel layer missing (conventions/juice.md): every game "
             "ships the juice library and wires updateJuice(dt)+drawJuice(ctx)")
        return
    src_text = ""
    for f in gameplay:
        try:
            src_text += f.read_text(encoding="utf-8", errors="ignore")
        except OSError:
            pass
    if "updateJuice(" not in src_text:
        warn("src/juice.js present but updateJuice(dt) is never called — wire it into the frame loop (conventions/juice.md)")
    elif "drawJuice(" not in src_text:
        warn("juice updates but never draws — call drawJuice(ctx) after render so floaters/trails show (conventions/juice.md)")
    else:
        ok("juice layer wired (updateJuice + drawJuice)")
    has_combat = any(k in src_text for k in ("hp -=", "hp-=", "damage", "takeDamage"))
    has_feedback = any(k in src_text for k in ("screenshake(", "hitstop(", "floater(", "burstParticles("))
    if has_combat and not has_feedback:
        warn("combat code found but no juice calls (screenshake/hitstop/floater/burstParticles) — "
             "hits need feedback (conventions/juice.md per-event checklist)")


def check_art() -> None:
    """Art-based games must ship real art, not blank placeholder shapes. If the
    source loads images but assets/ has none, the build skipped the free-asset
    fetch step (the core OGF value prop). Asset-free Canvas games (no image
    loading) are exempt."""
    src_text = ""
    for p in (ROOT / "src").rglob("*.js"):
        try:
            src_text += p.read_text(encoding="utf-8", errors="ignore")
        except Exception:
            pass
    if not any(t in src_text for t in ("drawImage(", "new Image(", "loadImage")):
        return  # asset-free Canvas game (draws shapes) — no art expected
    exts = {".png", ".jpg", ".jpeg", ".webp", ".gif"}
    imgs = [p for p in (ROOT / "assets").rglob("*") if p.suffix.lower() in exts]
    if not imgs:
        warn(
            "art-based game (source loads images) but assets/ has NO image files — it ships "
            "blank/placeholder shapes. Source real art FREE-FIRST: "
            "`python .agents/tools/fetch-asset.py search/fetch` (conventions/asset-sourcing.md); "
            "generate only as a fallback."
        )
    else:
        ok(f"art present ({len(imgs)} image asset(s) in assets/)")


SPRITE_FIELDS = ("sprite", "sheet", "image", "img", "frames", "src", "texture")


def _walk_objs(obj):
    """Yield every dict node in a parsed-JSON tree."""
    if isinstance(obj, dict):
        yield obj
        for v in obj.values():
            yield from _walk_objs(v)
    elif isinstance(obj, list):
        for v in obj:
            yield from _walk_objs(v)


def _animations_wired(anims) -> bool:
    """True if ≥1 animation entry points at a real sprite/sheet/frames."""
    if not isinstance(anims, dict) or not anims:
        return False  # empty `animations: {}` → fallback shape, not wired
    for v in anims.values():
        if isinstance(v, str) and v.strip():
            return True  # action -> "assets/..." direct
        if isinstance(v, dict) and any(v.get(k) for k in SPRITE_FIELDS):
            return True
    return False


def check_art_wired() -> None:
    """Fetched art must be WIRED into entity rendering, not left sitting in
    assets/ while characters draw as fallback shapes. If sprite art EXISTS and an
    entity declares `animations` but none reference a sprite (and it has no
    top-level sprite either), the game renders placeholder rectangles despite the
    art — the fetch-but-don't-wire failure ("Generating ≠ done"; the "looks phèn"
    bug). Skipped when no art was fetched (check_art covers the no-art case)."""
    exts = {".png", ".jpg", ".jpeg", ".webp", ".gif"}
    has_art = any(
        p.suffix.lower() in exts and p.is_file() for p in (ROOT / "assets").rglob("*")
    )
    if not has_art:
        return
    unwired = []
    for f in sorted(ROOT.glob("data/**/*.json")):
        try:
            data = json.loads(f.read_text(encoding="utf-8"))
        except Exception:
            continue  # check_json_and_assets already reported bad JSON
        for obj in _walk_objs(data):
            if (
                "animations" in obj
                and not _animations_wired(obj.get("animations"))
                and not any(obj.get(k) for k in SPRITE_FIELDS)
            ):
                unwired.append((rel(f), str(obj.get("id") or obj.get("name") or "?")))
    if unwired:
        for fr, ident in unwired[:8]:
            err(
                f"{fr}: '{ident}' has empty/unwired animations but sprite art EXISTS in assets/ — "
                "the game renders a FALLBACK SHAPE for it (looks unfinished). Wire a real sprite into "
                'EACH animation (e.g. "idle": {"sprite": "assets/sprites/<x>/sheet.png", "frames": N, '
                '"fw": W, "fh": H, "fps": 8}) + slice the sheet, so the game USES the fetched art. '
                "Shipping placeholder rectangles while art exists is NOT done."
            )
        if len(unwired) > 8:
            warn(f"...+{len(unwired) - 8} more entities with unwired animations")
    else:
        ok("art wiring: entity animations reference sprites")


def verify() -> None:
    check_js()
    check_json_and_assets()
    check_index()
    check_code_refs()
    check_undefined_refs()
    check_start_scene()
    check_juice()
    check_art()
    check_art_wired()
    for m in OKS:
        print(f"  ✓ {m}")
    for m in WARNINGS:
        print(f"  ! {m}")
    for m in ERRORS:
        print(f"  ✗ {m}")
    entries = load_protocol()
    hits = []
    for e in ERRORS:
        for p in entries:
            if p.get("kind") == "static" and p["match"].lower() in e.lower():
                hits.append(p)
                break
    if hits:
        print("\nknown fixes (debug protocol):")
        for p in hits:
            print(f"  → [{p['id']}] {p['fix']}")
    ensure_protocol_seed()
    print()
    if ERRORS:
        print(f"FAIL — {len(ERRORS)} error(s), {len(WARNINGS)} warning(s). Fix errors before the Play tab will work.")
        sys.exit(1)
    print(f"OK — 0 errors, {len(WARNINGS)} warning(s).")


def cmd_gotchas() -> None:
    print("Runtime gotchas (game runs but misbehaves — not statically checkable):")
    for p in load_protocol():
        if p.get("kind") == "runtime":
            print(f"  • {p['id']}: {p['cause']}\n      fix: {p['fix']}")


def cmd_record(signature: str, cause: str, fix: str) -> None:
    ensure_protocol_seed()
    entries = []
    if PROTOCOL_FILE.is_file():
        try:
            entries = json.loads(PROTOCOL_FILE.read_text(encoding="utf-8"))
        except (json.JSONDecodeError, OSError):
            entries = []
    entries.append({"id": f"learned_{len(entries)}", "kind": "runtime",
                    "match": signature, "cause": cause, "fix": fix})
    PROTOCOL_FILE.write_text(json.dumps(entries, indent=2) + "\n", encoding="utf-8")
    print(f"recorded → {PROTOCOL_FILE}")


def main():
    ap = argparse.ArgumentParser(description="OGF static verifier + debug protocol.")
    sub = ap.add_subparsers(dest="cmd")
    sub.add_parser("verify")
    sub.add_parser("gotchas")
    rp = sub.add_parser("record")
    rp.add_argument("--signature", required=True)
    rp.add_argument("--cause", default="")
    rp.add_argument("--fix", required=True)
    args = ap.parse_args()
    if args.cmd == "gotchas":
        cmd_gotchas()
    elif args.cmd == "record":
        cmd_record(args.signature, args.cause, args.fix)
    else:
        verify()


if __name__ == "__main__":
    main()
