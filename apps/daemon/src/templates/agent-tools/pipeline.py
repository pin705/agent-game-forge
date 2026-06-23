#!/usr/bin/env python3
"""pipeline — the OGF game-build state machine.

Adopted from OpenMontage's checkpoint state machine: walk a declarative pipeline
(.ogf/pipelines/game-build.yaml) one stage at a time, recording a checkpoint
after each so an interrupted build resumes from the last good stage. The agent
(your CLI) is the orchestrator; this tool just tracks WHERE the build is and
WHAT to do next.

Usage:
  python pipeline.py next                         # next stage + its director skill
  python pipeline.py start <stage>                # mark a stage in_progress
  python pipeline.py done  <stage> [--artifact P ...] [--approved]
  python pipeline.py status                       # progress table

State:    .ogf/pipeline/state.json
Manifest: .ogf/pipelines/game-build.yaml  (falls back to baked-in stage order)

Exit codes: 0 ok · 1 args/usage · 2 unknown stage
"""

from __future__ import annotations

import argparse
import json
import sys
import time
from pathlib import Path

# Baked-in canonical pipeline — used if the manifest is missing/unparseable, so
# the tool always works (mirrors OpenMontage's CANONICAL_STAGE_ARTIFACTS fallback).
CANONICAL = [
    {"name": "discovery",     "title": "Discovery",     "skill": "pipelines/stages/discovery-director.md",     "requires": [],                       "human_approval_default": True},
    {"name": "spec",          "title": "Spec",          "skill": "pipelines/stages/spec-director.md",          "requires": ["discovery"],            "human_approval_default": True},
    {"name": "art_direction", "title": "Art direction", "skill": "pipelines/stages/art-direction-director.md", "requires": ["spec"],                 "human_approval_default": True},
    {"name": "assets",        "title": "Assets",        "skill": "pipelines/stages/assets-director.md",        "requires": ["art_direction"],        "human_approval_default": False},
    {"name": "scaffold",      "title": "Scaffold",      "skill": "pipelines/stages/scaffold-director.md",      "requires": ["spec"],                 "human_approval_default": False},
    {"name": "systems",       "title": "Systems",       "skill": "pipelines/stages/systems-director.md",       "requires": ["scaffold", "assets"],   "human_approval_default": False},
    {"name": "verify",        "title": "Verify",        "skill": "pipelines/stages/verify-director.md",        "requires": ["systems"],              "human_approval_default": False},
    {"name": "publish",       "title": "Publish",       "skill": "pipelines/stages/publish-director.md",       "requires": ["verify"],               "human_approval_default": True},
]


def find_root() -> Path:
    cur = Path.cwd()
    for p in [cur, *cur.parents]:
        if (p / ".ogf").is_dir():
            return p
    return cur


ROOT = find_root()
MANIFEST = ROOT / ".ogf" / "pipelines" / "game-build.yaml"
STATE = ROOT / ".ogf" / "pipeline" / "state.json"


# ── Minimal YAML reader for our manifest's `stages:` block ──────────────────
# Handles exactly the shape we author: 2-space indent, `- name:` list items with
# 4-space `key: value` fields, inline [lists], and booleans. Not a general YAML
# parser — falls back to CANONICAL on any surprise.
def _scalar(v: str):
    v = v.strip()
    if v.startswith("[") and v.endswith("]"):
        inner = v[1:-1].strip()
        return [x.strip().strip('"\'') for x in inner.split(",") if x.strip()] if inner else []
    if " #" in v:
        v = v.split(" #", 1)[0].strip()
    if v in ("true", "True"):
        return True
    if v in ("false", "False"):
        return False
    return v.strip().strip('"\'')


def parse_manifest(path: Path):
    try:
        lines = path.read_text(encoding="utf-8").splitlines()
    except OSError:
        return None
    stages, cur, in_stages = [], None, False
    for raw in lines:
        if not raw.strip() or raw.lstrip().startswith("#"):
            continue
        indent = len(raw) - len(raw.lstrip(" "))
        line = raw.strip()
        if indent == 0:
            in_stages = (line.rstrip() == "stages:")
            if cur:
                stages.append(cur); cur = None
            continue
        if not in_stages:
            continue
        if line.startswith("- "):                 # new stage item
            if cur:
                stages.append(cur)
            cur = {}
            line = line[2:].strip()                # first field on the dash line
        if cur is not None and ":" in line:
            k, v = line.split(":", 1)
            cur[k.strip()] = _scalar(v)
    if cur:
        stages.append(cur)
    cleaned = [s for s in stages if s.get("name")]
    return cleaned or None


def stages() -> list:
    return parse_manifest(MANIFEST) or CANONICAL


def load_state() -> dict:
    if STATE.is_file():
        try:
            return json.loads(STATE.read_text(encoding="utf-8"))
        except (json.JSONDecodeError, OSError):
            pass
    return {"version": "1.0", "pipeline": "game-build", "stages": {}}


def save_state(st: dict) -> None:
    st["updated"] = time.strftime("%Y-%m-%dT%H:%M:%S")
    STATE.parent.mkdir(parents=True, exist_ok=True)
    STATE.write_text(json.dumps(st, indent=2) + "\n", encoding="utf-8")


def stage_status(st: dict, name: str) -> str:
    return st.get("stages", {}).get(name, {}).get("status", "pending")


def find(name: str):
    return next((s for s in stages() if s["name"] == name), None)


def cmd_next() -> None:
    st = load_state()
    for s in stages():
        if stage_status(st, s["name"]) != "completed":
            reqs = s.get("requires", []) or []
            unmet = [r for r in reqs if stage_status(st, r) != "completed"]
            gate = "YES — needs user approval" if s.get("human_approval_default") else "no (auto)"
            print(f"next stage : {s['name']}  ({s.get('title', s['name'])})")
            print(f"read       : .ogf/{s['skill']}")
            print(f"approval   : {gate}")
            if reqs:
                print(f"requires   : {', '.join(reqs)}" + (f"   ⚠ NOT DONE: {', '.join(unmet)}" if unmet else "   ✓"))
            print(f"then       : python .agents/tools/pipeline.py done {s['name']}" +
                  (" --approved" if s.get("human_approval_default") else ""))
            return
    print("pipeline complete — all stages done. 🎮")


def cmd_start(name: str) -> None:
    if not find(name):
        print(f"error: unknown stage '{name}'", file=sys.stderr); sys.exit(2)
    st = load_state()
    st.setdefault("stages", {}).setdefault(name, {})
    st["stages"][name].update({"status": "in_progress", "at": time.strftime("%Y-%m-%dT%H:%M:%S")})
    save_state(st)
    print(f"started: {name}")


def cmd_done(name: str, artifacts: list, approved: bool) -> None:
    s = find(name)
    if not s:
        print(f"error: unknown stage '{name}'", file=sys.stderr); sys.exit(2)
    st = load_state()
    entry = st.setdefault("stages", {}).setdefault(name, {})
    entry.setdefault("artifacts", [])
    entry["artifacts"] = sorted(set(entry["artifacts"]) | set(artifacts))
    entry["at"] = time.strftime("%Y-%m-%dT%H:%M:%S")
    if s.get("human_approval_default") and not approved:
        entry["status"] = "awaiting_human"
        entry["approved"] = False
        save_state(st)
        print(f"⏸ {name} is an APPROVAL GATE. Present the result to the user, then re-run:")
        print(f"   python .agents/tools/pipeline.py done {name} --approved")
        return
    entry["status"] = "completed"
    entry["approved"] = bool(approved)
    save_state(st)
    print(f"✓ {name} completed" + (" (approved)" if approved else ""))
    cmd_next()


def cmd_status() -> None:
    st = load_state()
    mark = {"completed": "✓", "in_progress": "▶", "awaiting_human": "⏸", "pending": "·"}
    print(f"pipeline: game-build   (state: {STATE})")
    for s in stages():
        stt = stage_status(st, s["name"])
        appr = st.get("stages", {}).get(s["name"], {}).get("approved")
        tag = "  [approval gate]" if s.get("human_approval_default") else ""
        appr_s = "  approved" if appr else ""
        print(f"  {mark.get(stt, '·')} {s['name']:<14} {stt}{appr_s}{tag}")


def main() -> None:
    ap = argparse.ArgumentParser(description="OGF game-build pipeline state machine.")
    sub = ap.add_subparsers(dest="cmd", required=True)
    sub.add_parser("next")
    sub.add_parser("status")
    sp = sub.add_parser("start"); sp.add_argument("stage")
    dp = sub.add_parser("done")
    dp.add_argument("stage")
    dp.add_argument("--artifact", action="append", default=[], metavar="PATH")
    dp.add_argument("--approved", action="store_true")
    args = ap.parse_args()
    if args.cmd == "next":
        cmd_next()
    elif args.cmd == "status":
        cmd_status()
    elif args.cmd == "start":
        cmd_start(args.stage)
    elif args.cmd == "done":
        cmd_done(args.stage, args.artifact, args.approved)


if __name__ == "__main__":
    main()
