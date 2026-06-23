# Verify director

**Stage goal:** a clean final static pass before handing the game to the user.

**Produces:** `verify_report`.

## Process

1. Run the full static verifier from the project root:
   ```
   python .agents/tools/verify-game.py
   ```
   It checks JS syntax, JSON validity, OGF level schema, asset-path resolution,
   and `index.html` references (`conventions/verification.md`).
2. Fix every reported error and re-run until exit 0. Common misses: a `data/*.json`
   referencing a sprite that wasn't fetched/generated; an array entry missing its
   `id`; a level missing top-level `mapSize`.
3. Confirm every asset in `data/asset-credits.json` still exists on disk.

Auto-advance; checkpoint with the report.

## Done when

`verify-game.py` exits 0 and asset paths resolve. `pipeline.py done verify`.
