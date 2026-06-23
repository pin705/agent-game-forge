# Art-direction director

**Stage goal:** lock the visual look and decide, per asset, fetch-vs-generate —
BEFORE mass-producing assets.

**Produces:** `style_anchor` (the look reference) + an asset plan.

## Process

1. **Establish the look.** For a generic style, fetch a representative free asset
   as the anchor; for a restrictive/custom style, generate the style anchor (see
   common.md "Style anchor"). Either way, one clear reference the rest match.
2. **Plan each asset free-first.** For every named sprite/tile/sfx/music in the
   spec, decide its source using `conventions/asset-sourcing.md`:
   - default → `fetch-asset` (free, instant, attribution recorded)
   - generate only when the style is too specific for stock to match.
   Record the plan (which assets fetch, which generate) — the `assets` stage
   executes it.
3. **Approval gate.** Show the user the anchor + the fetch/generate split (and the
   $ implication: fetched = $0, generated = uses their key). Get sign-off.

## Done when

Anchor approved + asset plan written. `pipeline.py done art_direction --approved`.
