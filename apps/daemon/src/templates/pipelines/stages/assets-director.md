# Assets director

**Stage goal:** put every named asset on disk under `assets/`, **free-first, and
never block on a missing API key.** A game must come out with real art using only
free sources; AI generation is an *upgrade* applied when a key is configured.

**Produces:** `asset_manifest` (the files + `data/asset-credits.json`).

## The default art flow (free-fetch first, AI only when available)

For EVERY asset in the art-direction plan, in this order:

1. **Fetch a free asset (DEFAULT — always do this first):**
   ```
   python .agents/tools/fetch-asset.py fetch "<query>" assets/<path> --kind <kind>
   ```
   Live CC0/CC-BY from OpenGameArt/Kenney/curated, commercial-safe, attribution
   auto-recorded in `data/asset-credits.json`. This needs **no API key** and is the
   standard path — most assets should come from here.

2. **Upgrade to AI-generated art ONLY when a key is configured AND the plan marks
   the asset "bespoke"** (a signature character/boss/key art that free sources
   can't match):
   ```
   python .agents/tools/gen-image.py "<prompt>" assets/<path> [--ref ...]
   ```
   `gen-image.py` exits non-zero with "No API key configured" when the daemon has
   no image-gen key. **That is NOT a build failure** — treat it as "AI unavailable":
   catch it and fall back to step 1 (fetch a free asset for that slot). Never let a
   missing key stop the stage or leave a slot empty.

3. **If neither yields a fitting asset, leave the slot asset-free** (empty `sprite`
   field) — the seed's renderer draws a polished fallback shape (`conventions/
   i18n-and-mobile.md` §3). A degraded-but-clean look beats a 404 or a blank.

4. **Wire it immediately.** Fetching/generating ≠ done — reference the asset in the
   right `data/*.json` the same turn (common.md "Generating ≠ done"), and make sure
   no `data/*.json` points at a path that isn't on disk (the browser QA gate fails
   on 404s).

> Decision rule in one line: **free-fetch by default → AI only if key present and
> the asset is bespoke → shape fallback if all else fails.** The game always ships
> with art (free), and looks better automatically once the user adds an image-gen
> key in the studio Settings.

This stage is **auto-advance** (no approval gate) but still checkpoints.

## Done when

Every named asset resolves on disk (free-fetched, AI-generated, or intentionally
left to the shape fallback) and is referenced in data; CC-BY assets have
attribution. No `data/*.json` references a missing file.
`pipeline.py done assets --artifact data/asset-credits.json`.
