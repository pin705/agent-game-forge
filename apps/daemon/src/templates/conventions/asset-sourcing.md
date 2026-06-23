# OGF — asset sourcing (free-first, read before generating any art)

> ⚠️ Generating every sprite/tile/sfx with an image model is the single
> biggest recurring COST in agent game-making. Most 2D assets don't need to
> be bespoke. Before you generate, try to **fetch a free, commercial-safe
> asset** that already exists. This is the chassis-native distillation of
> OpenMontage's multi-source asset broker.

## The free-first rule

For every visual/audio asset a phase needs, follow this order:

1. **Fetch.** Search the free-asset broker:
   ```
   python .agents/tools/fetch-asset.py search "<what you need>" --kind <kind>
   ```
   `--kind`: `sprite | tileset | pickup | sfx | music | background`.
   If a good commercial-safe match exists, download it:
   ```
   python .agents/tools/fetch-asset.py fetch "<query>" assets/<path>/<name>.png --kind <kind>
   ```
   The asset lands as a plain PNG (or audio file) — wire it into `data/*.json`
   exactly like a generated one. The broker auto-records attribution in
   `data/asset-credits.json` + a `<file>.license.txt` sidecar.

2. **Generate** (only if no free asset fits the art direction): fall back to
   the `generate2dsprite` / `generate2dmap` procedure (see common.md) via your
   CLI's image route or `.agents/tools/gen-image.py`.

When to skip straight to generation: the project has a **restrictive/custom
art style** (ink-wash, specific palette, named IP look) where stock assets
would clash. Free-first is for the common case (generic platformer hero,
coins, tiles, UI, SFX), not for art-directed hero assets.

## Commercial safety — non-negotiable for a shippable game

- `fetch` is **commercial-safe by default**: it only uses entries the catalog
  marks `commercial_ok` (CC0 / cleared CC-BY). Attribution is recorded for you.
- Entries marked `VERIFY-LICENSE` are only considered with
  `--include-unverified`. If you use one, **surface the source link to the
  user via a `<question-form>`** and ask them to confirm the license before it
  ships. Never silently ship an unverified-license asset.
- `data/asset-credits.json` is the project's attribution ledger. Keep it — a
  CC-BY asset without attribution is a license violation.

## How this fits the pipeline

`fetch-asset` is an ALTERNATE/PRIOR step to the image skills, not a
replacement. The downstream contract is identical: asset on disk under
`assets/` → referenced from `data/*.json` → visible in Play tab + editable in
Scenes tab. Generating ≠ done and fetching ≠ done — both require wiring the
reference into game data in the same turn (see common.md "Generating ≠ done").

## Roadmap (not yet — informational)

The current broker is a small curated catalog (one "source adapter"). It will
grow into live multi-source adapters (OpenGameArt search, Kenney, Freesound,
Wikimedia) with CLIP semantic ranking — same `fetch-asset.py` interface, more
and better matches. You don't need to do anything for that; keep using
`search` / `fetch`.
