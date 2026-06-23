#!/usr/bin/env python3
"""fetch-asset — the OGF free-asset broker (multi-source, cost-center killer).

Why this exists:
  Generating every sprite / tile / sfx with an image model is the biggest
  recurring COST in agent game-making. Huge libraries of free, commercial-safe
  (CC0 / CC-BY) assets already exist. This tool SEARCHES those libraries and
  DOWNLOADS a matching asset into the project for $0, before falling back to
  generation. It is the chassis-native distillation of OpenMontage's
  multi-source corpus + selector pattern.

  Pairs with gen-image.py: try fetch-asset FIRST; generate only when no free
  asset fits the art direction. See .ogf/conventions/asset-sourcing.md.

  Output is a plain file under assets/ exactly like a generated one, so the
  rest of the OGF pipeline (wire into data/*.json, Scene editor, Play tab) is
  unchanged.

Sources (OpenMontage "StockSource" plugin pattern — subclass to add more):
  - opengameart : LIVE OpenGameArt.org search, license-filtered to
                  commercial-safe licenses; resolves file URL + license +
                  author from the content page.
  - kenney      : Kenney's CC0 catalog, via OpenGameArt's CC0-filtered index
                  (Kenney mirrors there) — uniform CC0, no license ambiguity.
  - freesound   : LIVE Freesound.org SFX/music search (CC0 + Attribution).
                  Needs a token in $FREESOUND_API_KEY or ~/.ogf/secrets.json
                  ("freesound_api_key"); inactive without one.
  - curated     : small built-in CC0 catalog (offline fallback / pin-list).

Ranking:
  v2 lexical-semantic: query tokens are expanded with a game-asset synonym
  thesaurus, scored against title+tags, kind-aware, with a pack/sheet penalty
  for single-item kinds (so a real "coin" outranks a giant tileset). The
  relevance() function is the isolated seam where a CLIP backend can drop in
  (see --ranker; CLIP requires open-clip-torch and is not bundled).

Usage:
  python fetch-asset.py search "<query>" [--kind KIND] [--source S] [--limit N] [--json]
  python fetch-asset.py fetch  "<query>" <output> [--kind KIND] [--source S] [--index N]
  python fetch-asset.py list

Kinds:   sprite | character | tileset | pickup | background | texture | sfx | music

Licensing:
  COMMERCIAL-SAFE BY DEFAULT (CC0 + CC-BY). Attribution (author + license +
  source) is recorded for every fetch in data/asset-credits.json + a
  <output>.license.txt sidecar. CC0 needs no attribution; CC-BY REQUIRES it.

Exit codes:
  0 success   1 args/file error   2 network unreachable   3 no match / download error
"""

from __future__ import annotations

import argparse
import hashlib
import html as _html
import json
import os
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

CACHE_DIR = Path.home() / ".ogf" / "asset-cache"
UA = "ogf-fetch-asset/0.3 (+https://opengameart.org)"

# OpenGameArt taxonomy ids (verified from the advanced-search form).
OGA_TYPE = {"sprite": 9, "character": 9, "pickup": 9, "tileset": 9,
            "background": 9, "texture": 14, "sfx": 13, "music": 12}
OGA_LICENSE_TID = {"CC0": 4, "CC-BY 3.0": 2, "CC-BY 4.0": 17981,
                   "OGA-BY 3.0": 10310, "OGA-BY 4.0": 31772,
                   "CC-BY-SA 3.0": 3, "CC-BY-SA 4.0": 17982,
                   "GPL 3.0": 6, "GPL 2.0": 5}
# Default: cleanest commercial licenses. CC-BY-SA (share-alike) + GPL (copyleft)
# are excluded by default — risky to mix into a proprietary game.
DEFAULT_LICENSES = ["CC0", "CC-BY 3.0", "CC-BY 4.0"]
COMMERCIAL_SAFE = set(DEFAULT_LICENSES) | {"OGA-BY 3.0", "OGA-BY 4.0",
                                           "Creative Commons 0", "Attribution"}
ATTRIBUTION_FREE = {"CC0", "Creative Commons 0"}

IMAGE_EXT = ("png", "jpg", "jpeg", "gif")
AUDIO_EXT = ("ogg", "wav", "mp3")

# ── Ranking v2: game-asset synonym thesaurus ────────────────────────────────
SYNONYMS = {
    "hero": ["character", "player", "protagonist", "knight", "warrior", "adventurer"],
    "character": ["hero", "player", "sprite", "npc", "person"],
    "player": ["hero", "character", "avatar"],
    "enemy": ["monster", "foe", "creature", "mob", "boss", "villain"],
    "coin": ["gold", "money", "currency", "pickup", "collectible", "treasure", "gem"],
    "pickup": ["coin", "collectible", "item", "powerup", "loot"],
    "tile": ["tileset", "ground", "terrain", "platform", "floor", "block", "brick"],
    "tileset": ["tiles", "ground", "terrain", "platform"],
    "ground": ["tile", "terrain", "floor", "dirt", "grass"],
    "background": ["bg", "backdrop", "sky", "parallax", "scenery", "landscape"],
    "explosion": ["blast", "boom", "burst", "fx", "effect"],
    "jump": ["hop", "leap", "bounce"],
    "shoot": ["fire", "shot", "laser", "bullet", "projectile"],
    "bullet": ["projectile", "shot", "laser", "missile"],
    "spaceship": ["ship", "spacecraft", "rocket", "fighter"],
    "tree": ["plant", "foliage", "bush", "forest"],
    "ui": ["interface", "hud", "button", "menu", "icon"],
    "heart": ["health", "life", "hp"],
    "key": ["unlock", "door"],
}
PACK_WORDS = {"pack", "set", "collection", "bundle", "kit", "atlas", "sheet", "tilesheet"}
SINGLE_KINDS = {"sprite", "character", "pickup"}


def tokenize(text: str) -> list:
    return [t for t in re.split(r"[^a-z0-9]+", text.lower()) if t]


def expand_query(query: str) -> list:
    """Return [(term, weight)] — query tokens at weight 3, synonyms at 1."""
    terms = {}
    for tok in tokenize(query):
        terms[tok] = max(terms.get(tok, 0), 3)
        for syn in SYNONYMS.get(tok, []):
            terms[syn] = max(terms.get(syn, 0), 1)
    return list(terms.items())


def relevance(weighted_query: list, kind: str | None, title: str, tags=()) -> int:
    """Isolated ranking seam (v2 lexical-semantic). A CLIP backend would
    replace this with image/text embedding cosine similarity."""
    text = set(tokenize(title)) | {t.lower() for t in tags}
    score = 0
    for term, w in weighted_query:
        if term in text:
            score += w + 1
        elif any(term in t or t in term for t in text):
            score += 1
    if kind and kind in text:
        score += 2
    # Pack/sheet penalty: when the user wants ONE asset, a giant pack is a
    # worse match than a dedicated single asset. This is what fixed the
    # "gold coin" → RPG-tileset mis-rank.
    if kind in SINGLE_KINDS and (set(tokenize(title)) & PACK_WORDS):
        score -= 4
    return score


def http_get(url: str, use_cache: bool = True, headers=None) -> str | None:
    if use_cache:
        cf = CACHE_DIR / (hashlib.sha1(url.encode()).hexdigest() + ".cache")
        if cf.is_file():
            return cf.read_text(encoding="utf-8", errors="replace")
    try:
        req = urllib.request.Request(url, headers={"User-Agent": UA, **(headers or {})})
        with urllib.request.urlopen(req, timeout=25) as r:
            body = r.read().decode("utf-8", errors="replace")
    except urllib.error.HTTPError as e:
        print(f"warning: HTTP {e.code} for {url}", file=sys.stderr)
        return None
    except (urllib.error.URLError, TimeoutError) as e:
        print(f"warning: network issue for {url}: {e}", file=sys.stderr)
        return None
    if use_cache:
        CACHE_DIR.mkdir(parents=True, exist_ok=True)
        cf.write_text(body, encoding="utf-8")
    return body


def http_download(url: str, out: Path) -> None:
    out.parent.mkdir(parents=True, exist_ok=True)
    try:
        req = urllib.request.Request(url, headers={"User-Agent": UA})
        with urllib.request.urlopen(req, timeout=60) as r:
            data = r.read()
    except urllib.error.HTTPError as e:
        print(f"error: HTTP {e.code} fetching {url}", file=sys.stderr)
        sys.exit(3)
    except (urllib.error.URLError, TimeoutError) as e:
        print(f"error: network unreachable: {e}", file=sys.stderr)
        sys.exit(2)
    out.write_bytes(data)


def secret(name: str) -> str | None:
    if os.environ.get(name.upper()):
        return os.environ[name.upper()]
    sf = Path.home() / ".ogf" / "secrets.json"
    if sf.is_file():
        try:
            return json.loads(sf.read_text()).get(name.lower())
        except (json.JSONDecodeError, OSError):
            return None
    return None


# ── Source plugins ──────────────────────────────────────────────────────────

class CuratedSource:
    """Built-in CC0 catalog. Offline fallback + place to pin known-good assets."""
    name = "curated"
    CATALOG = [
        {"id": "green_cap_hero", "kind": "sprite",
         "tags": ["hero", "character", "player", "platformer", "adventurer"],
         "url": "https://opengameart.org/sites/default/files/Green-Cap-Character-16x18.png",
         "license": "CC0", "author": "Surt",
         "page": "https://opengameart.org/content/green-cap-character-16x18"},
    ]

    def search(self, wq, kind, limit):
        rows = []
        for e in self.CATALOG:
            s = relevance(wq, kind, e["id"], e["tags"])
            if s > 0:
                rows.append({"source": self.name, "id": e["id"], "title": e["id"],
                             "kind": e["kind"], "url": e["url"], "license": e["license"],
                             "author": e["author"], "page": e["page"], "score": s})
        rows.sort(key=lambda r: -r["score"])
        return rows[:limit]

    def resolve(self, c):
        return c


class OpenGameArtSource:
    name = "opengameart"
    BASE = "https://opengameart.org"

    def __init__(self, licenses=None):
        self.licenses = licenses or DEFAULT_LICENSES

    def _keys(self, query):
        return query

    def search(self, wq, kind, limit, _query=""):
        params = [("keys", self._keys(_query)), ("sort_by", "count"), ("sort_order", "DESC")]
        params.append(("field_art_type_tid[]", OGA_TYPE.get(kind or "sprite", 9)))
        for lic in self.licenses:
            if lic in OGA_LICENSE_TID:
                params.append(("field_art_licenses_tid[]", OGA_LICENSE_TID[lic]))
        html = http_get(self.BASE + "/art-search-advanced?" + urllib.parse.urlencode(params))
        if not html:
            return []
        rows = []
        for pos, (slug, title) in enumerate(self._parse_search(html)[:limit]):
            rows.append({"source": self.name, "id": slug.strip("/").split("/")[-1],
                         "title": title, "kind": kind or "sprite",
                         "page": self.BASE + slug, "url": None, "license": None,
                         "author": None,
                         "score": relevance(wq, kind, title) + max(0, 8 - pos)})
        rows.sort(key=lambda r: -r["score"])
        return rows

    def resolve(self, c):
        if c.get("url"):
            return c
        html = http_get(c["page"])
        if not html:
            return None
        info = self._parse_content(html)
        exts = AUDIO_EXT if c.get("kind") in ("sfx", "music") else IMAGE_EXT
        chosen = next((f for f in info["files"] if f.rsplit(".", 1)[-1].lower() in exts), None)
        if not chosen:
            return None
        c["url"] = chosen
        c["license"] = info["licenses"][0] if info["licenses"] else "unknown"
        c["author"] = info["author"] or "OpenGameArt contributor"
        return c

    @staticmethod
    def _parse_search(html):
        out, seen = [], set()
        for a in re.finditer(r'art-preview-title"><a href="(/content/[^"]+)">([^<]+)</a>', html):
            slug, title = a.group(1), _html.unescape(a.group(2)).strip()
            if slug in seen or not title:
                continue
            seen.add(slug)
            out.append((slug, title))
        return out

    @staticmethod
    def _parse_content(html):
        seg = re.search(r'field-name-field-art-files(.*?)(?:<h2|<footer|</article|field-name-field-art-tags)', html, re.S)
        scope = seg.group(1) if seg else html
        files = re.findall(r'href="(https://opengameart\.org/sites/default/files/[^"]+\.(?:png|jpg|jpeg|gif|zip|ogg|wav|mp3))"', scope, re.I)
        lic = re.search(r'field-name-field-art-licenses(.*?)</div>\s*</div>', html, re.S)
        labels = sorted(set(re.findall(r'(CC0|CC-BY-SA \d\.\d|CC-BY \d\.\d|OGA-BY \d\.\d|GPL \d\.\d)', lic.group(1)))) if lic else []
        au = re.search(r'href="(/users/[^"]+)"[^>]*>([^<]+)</a>', html)
        return {"files": files, "licenses": labels, "author": au.group(2).strip() if au else None}


class KenneySource(OpenGameArtSource):
    """Kenney's CC0 catalog, surfaced via OpenGameArt's CC0-filtered index."""
    name = "kenney"

    def __init__(self):
        super().__init__(licenses=["CC0"])

    def _keys(self, query):
        return (query + " kenney").strip()

    def search(self, wq, kind, limit, _query=""):
        rows = super().search(wq, kind, limit, _query=_query)
        for r in rows:
            r["source"] = self.name
        return rows


class FreesoundSource:
    """LIVE Freesound.org SFX/music. Token-gated (commercial-safe filter)."""
    name = "freesound"
    API = "https://freesound.org/apiv2/search/text/"

    def __init__(self):
        self.token = secret("freesound_api_key")
        self._warned = False

    def search(self, wq, kind, limit, _query=""):
        if kind not in (None, "sfx", "music"):
            return []
        if not self.token:
            if not self._warned:
                print("note: freesound source needs a token "
                      "($FREESOUND_API_KEY or ~/.ogf/secrets.json freesound_api_key) — skipped.",
                      file=sys.stderr)
                self._warned = True
            return []
        params = urllib.parse.urlencode({
            "query": _query, "page_size": min(limit, 15),
            "filter": 'license:("Creative Commons 0" OR "Attribution")',
            "fields": "id,name,license,username,previews", "token": self.token})
        body = http_get(self.API + "?" + params, use_cache=False)
        if not body:
            return []
        try:
            data = json.loads(body)
        except json.JSONDecodeError:
            return []
        rows = []
        for r in data.get("results", []):
            prev = r.get("previews", {}) or {}
            url = prev.get("preview-hq-ogg") or prev.get("preview-hq-mp3")
            if not url:
                continue
            lic = "CC0" if "zero" in (r.get("license") or "").lower() or "Creative Commons 0" in (r.get("license") or "") else "CC-BY 4.0"
            rows.append({"source": self.name, "id": "fs_" + str(r["id"]),
                         "title": r.get("name", ""), "kind": kind or "sfx",
                         "page": f"https://freesound.org/s/{r['id']}/",
                         "url": url, "license": lic, "author": r.get("username"),
                         "score": relevance(wq, kind, r.get("name", "")) + 1})
        rows.sort(key=lambda r: -r["score"])
        return rows

    def resolve(self, c):
        return c


def build_sources(which):
    table = {"opengameart": OpenGameArtSource, "kenney": KenneySource,
             "freesound": FreesoundSource, "curated": CuratedSource}
    if which == "all":
        return [OpenGameArtSource(), KenneySource(), FreesoundSource(), CuratedSource()]
    if which not in table:
        print(f"error: unknown source '{which}'", file=sys.stderr)
        sys.exit(1)
    return [table[which]()]


def gather(sources, query, kind, limit):
    wq = expand_query(query)
    rows = []
    for src in sources:
        try:
            rows.extend(src.search(wq, kind, limit, _query=query))
        except TypeError:
            rows.extend(src.search(wq, kind, limit))
        except Exception as e:
            print(f"warning: source {src.name} failed: {e}", file=sys.stderr)
    rows.sort(key=lambda r: -r["score"])
    return rows[:limit]


def commercial_ok(label: str) -> bool:
    return label in COMMERCIAL_SAFE


def record_credit(c, out: Path, query: str) -> Path:
    cwd = Path.cwd()
    credits = cwd / "data" / "asset-credits.json"
    credits.parent.mkdir(parents=True, exist_ok=True)
    items = []
    if credits.is_file():
        try:
            items = json.loads(credits.read_text(encoding="utf-8"))
        except (json.JSONDecodeError, OSError):
            items = []
    rel = str(out.relative_to(cwd)) if cwd in out.parents else str(out)
    items = [it for it in items if it.get("asset") != rel]
    items.append({"asset": rel, "id": c["id"], "source": c["source"],
                  "license": c["license"], "author": c["author"],
                  "page": c.get("page"), "url": c["url"], "query": query,
                  "fetched_at": time.strftime("%Y-%m-%dT%H:%M:%S")})
    credits.write_text(json.dumps(items, indent=2) + "\n", encoding="utf-8")
    attr = "(public domain — no attribution required)" if c["license"] in ATTRIBUTION_FREE \
        else f'REQUIRED: "{c["id"]}" by {c["author"]} — {c["license"]}'
    out.with_suffix(out.suffix + ".license.txt").write_text(
        f"{c['author']} — {c['license']}\nsource: {c.get('page')}\nattribution: {attr}\n",
        encoding="utf-8")
    return credits


def fmt(c) -> str:
    return (f"{c['source']:<11} {c['title'][:46]:<46} [{c['kind']:<9}] {c.get('license') or '?'}\n"
            f"    {c.get('page') or c.get('url')}")


def main() -> None:
    ap = argparse.ArgumentParser(description="OGF free-asset broker (multi-source).",
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="cmd", required=True)
    for name in ("search", "fetch"):
        p = sub.add_parser(name)
        p.add_argument("query")
        if name == "fetch":
            p.add_argument("output")
            p.add_argument("--index", type=int, default=0)
        p.add_argument("--kind", choices=sorted(OGA_TYPE))
        p.add_argument("--source", default="all",
                       choices=["all", "opengameart", "kenney", "freesound", "curated"])
        p.add_argument("--limit", type=int, default=12)
        p.add_argument("--ranker", default="lexical", choices=["lexical", "clip"],
                       help="clip requires open-clip-torch (not bundled); falls back to lexical.")
        if name == "search":
            p.add_argument("--json", action="store_true")
    sub.add_parser("list")
    args = ap.parse_args()

    if getattr(args, "ranker", "lexical") == "clip":
        try:
            import open_clip  # noqa: F401
        except ImportError:
            print("note: --ranker clip needs `pip install open-clip-torch`; using lexical v2.",
                  file=sys.stderr)

    if args.cmd == "list":
        for e in CuratedSource.CATALOG:
            print(f"curated  {e['id']:<20} [{e['kind']}] {e['license']}  {e['page']}")
        return

    sources = build_sources(args.source)

    if args.cmd == "search":
        rows = gather(sources, args.query, args.kind, args.limit)
        if args.json:
            print(json.dumps(rows, indent=2))
            return
        if not rows:
            print("no matches. broaden the query, drop --kind, or fall back to gen-image.py.")
            return
        for i, c in enumerate(rows):
            print(f"[{i}] score={c['score']}  {fmt(c)}")
        return

    rows = gather(sources, args.query, args.kind, max(args.limit, args.index + 6))
    if not rows:
        print("error: no free match. Use gen-image.py to generate.", file=sys.stderr)
        sys.exit(3)
    for c in rows[args.index:]:
        src = next((s for s in sources if s.name == c["source"]), None)
        resolved = src.resolve(c) if src else None
        if not resolved or not resolved.get("url"):
            continue
        if not commercial_ok(resolved["license"]):
            print(f"  skip {resolved['id']}: license {resolved['license']} not commercial-safe", file=sys.stderr)
            continue
        out = Path(args.output).resolve()
        http_download(resolved["url"], out)
        credits = record_credit(resolved, out, args.query)
        print(f"fetched {resolved['id']} ({resolved['license']}, by {resolved['author']}) → {args.output}")
        print(f"  attribution recorded in {credits}")
        if resolved["license"] not in ATTRIBUTION_FREE:
            print(f"  ⚠ {resolved['license']} REQUIRES crediting {resolved['author']} in your game's credits.")
        return
    print("error: matches found but none had a usable single file (packs/zip only). "
          "Try another query or gen-image.py.", file=sys.stderr)
    sys.exit(3)


if __name__ == "__main__":
    main()
