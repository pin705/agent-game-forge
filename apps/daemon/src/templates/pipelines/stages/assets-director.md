# Assets director

**Stage goal:** put every named asset on disk under `assets/`, free-first.

**Produces:** `asset_manifest` (the files + `data/asset-credits.json`).

## Process

Execute the art-direction asset plan. For each asset:

1. **Fetch first** (`conventions/asset-sourcing.md`):
   ```
   python .agents/tools/fetch-asset.py fetch "<query>" assets/<path> --kind <kind>
   ```
   Commercial-safe by default; attribution auto-recorded in `data/asset-credits.json`.
2. **Generate only as planned fallback** via the `generate2dsprite` /
   `generate2dmap` procedure (common.md) or `gen-image.py`.
3. **Wire it immediately.** Generating/fetching ≠ done — reference the asset in
   the right `data/*.json` the same turn (common.md "Generating ≠ done").

This stage is **auto-advance** (no approval gate) but still checkpoints.

## Done when

Every named asset resolves on disk and is referenced in data; CC-BY assets have
attribution. `pipeline.py done assets --artifact data/asset-credits.json`.
