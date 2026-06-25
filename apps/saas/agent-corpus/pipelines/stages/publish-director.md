# Publish director

**Stage goal:** hand the finished game to the user, license-clean.

**Produces:** `publish_log`.

## Process

1. **Credits.** Ensure CC-BY / OGA-BY assets are credited. Surface
   `data/asset-credits.json`; if the game has a title/credits screen or README,
   write the required attributions there (CC0 needs none; CC-BY REQUIRES it —
   see `conventions/asset-sourcing.md`).
2. **Run check.** Confirm the game runs from `index.html` (the user opens the
   Play tab, or serves the folder). Note the controls + win condition.
3. **Summary.** Tell the user: what was built, how to play, which assets were
   fetched free vs generated, and the build cost (free fetches = $0; list any
   gen-image calls).

**Approval gate** — this is the delivery. Confirm the user is happy.

## Done when

Credits in place + game runs + user has the summary. `pipeline.py done publish --approved`.
