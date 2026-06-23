# OGF — static game verification (run before declaring a phase done)

You are headless and must NOT spawn a browser (see common.md "Phase
verification"). Instead, run the static verifier — the chassis-correct
distillation of OpenGame's debug loop. It catches the same breakage classes a
browser run would (missing assets, broken JSON, bad refs, syntax errors)
without rendering anything.

## Run it

```
python .agents/tools/verify-game.py
```
Run from the project root, at the end of every phase that touched `src/`,
`data/`, `assets/`, or `index.html`. Exit code 0 = clean (or warnings only),
1 = errors that would leave the Play tab broken/empty.

## What it checks

| Check | Catches |
|---|---|
| JS syntax (`node --check` per `src/**/*.js`) | typos, unclosed braces — the #1 "blank canvas" cause |
| JSON validity (`data/**/*.json`) | trailing commas, bad quotes |
| OGF level schema | level missing `mapSize` or any renderable field (`background`/`layers`/`props`/`platforms`); array entries missing `id` (warned) |
| Asset paths | any `assets/…` path referenced in `data/` that doesn't exist on disk (the "Play tab empty" trap) |
| index.html refs | `<script src>` / `<link href>` pointing at missing local files |

## How to use the output

- `✓` lines = passed. `!` = warning (usually safe; e.g. an array entry missing
  `id` that the loader will auto-inject — but cleaner to add it). `✗` = error;
  fix before marking the phase done.
- Errors are concrete and file-located. Fix the file it names, re-run, repeat
  until `OK`.

## Scope (honest)

This is STATIC verification — it does not execute the game, so it can't catch
runtime logic bugs (wrong physics, an enemy that never spawns). Those are for
the user's Play-tab pass. The verifier exists to guarantee the game at least
*loads and renders* before you hand it back.
