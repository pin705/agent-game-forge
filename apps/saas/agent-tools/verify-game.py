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
    {"id": "no_renderable", "kind": "static", "match": "no renderable field",
     "cause": "A level JSON has mapSize but nothing to draw — Play/Scene editor is empty.",
     "fix": "Add one of background | layers[] | props[] | platforms[]. Scrolling camera → layers[]."},
    {"id": "mapsize", "kind": "static", "match": "mapSize must have numeric",
     "cause": "Level missing numeric mapSize.width/height; Scene editor can't open it.",
     "fix": "Add \"mapSize\": { \"width\": <n>, \"height\": <n> } at top level."},
    {"id": "missing_id", "kind": "static", "match": "missing 'id'",
     "cause": "Scene editor addresses every array entry by id; without it, drag-edit save fails.",
     "fix": "Give every array entry a unique \"id\" string (e.g. coin_1, plat_2)."},
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


def verify() -> None:
    check_js()
    check_json_and_assets()
    check_index()
    check_start_scene()
    check_juice()
    check_art()
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
