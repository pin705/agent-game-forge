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
"""

from __future__ import annotations

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
             "blockers", "walkBounds", "walkable")
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
            if not any(k in data for k in ("background", "layers", "props", "platforms")):
                err(f"{rel(f)}: level has no renderable field (background | layers | props | platforms) — Scene editor/Play will be empty")
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


def main():
    check_js()
    check_json_and_assets()
    check_index()

    for m in OKS:
        print(f"  ✓ {m}")
    for m in WARNINGS:
        print(f"  ! {m}")
    for m in ERRORS:
        print(f"  ✗ {m}")
    print()
    if ERRORS:
        print(f"FAIL — {len(ERRORS)} error(s), {len(WARNINGS)} warning(s). Fix errors before the Play tab will work.")
        sys.exit(1)
    print(f"OK — 0 errors, {len(WARNINGS)} warning(s).")


if __name__ == "__main__":
    main()
