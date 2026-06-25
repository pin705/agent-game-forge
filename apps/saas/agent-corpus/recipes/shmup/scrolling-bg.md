# Recipe — Scrolling background (shmup)

Implements the autoscrolling shmup backdrop: the world scrolls at a fixed speed
(vertical or horizontal), the player is clamped to a sub-rectangle of the
viewport, and the main background uses **segmented terrain** (3-5 distinct
panels) so the player feels they're traversing real ground — not stuck in place
over one repeating tile. An optional second parallax layer (stars / clouds) adds
depth.

## When to use

- Shmup genre — vertical (Galaga) or horizontal (R-Type / Gradius) scroller
- Background should convey forward progression through distinct terrain
- Layer data lives in `data/<stage>.json` `layers[]` (per `genres/shmup.md`)

## When NOT to use

- **Boss arena** (fixed-camera one-screen fight) — use a single static
  `background: { image: "..." }`, NO scroll, NO segments, NO parallax. The boss
  stage should read as a distinct place, not a continuation of the scroll.
- **Arena-survivor** — that genre IS one big repeating tile that scrolls with the
  camera (intentional). Use `genres/arena-survivor.md` §Background instead.
- **Side-scroll platformer parallax** — that uses 4 tileable strips + `repeatX`
  driven by player position, not a forced autoscroll. Use
  `recipes/side-scroll/parallax-layers.md`.

## Files this affects

- `src/stages.js` — scroll advance + segment progression + player clamp (~100-200 LOC)
- `src/render.js` (or `src/scroll.js`) — `drawScrollingBg()` (~40-60 LOC)
- `data/<stage>.json` — IDENTITY: `layers[]`, `scrollAxis`, `scrollSpeed`, `playerBounds`
- `assets/maps/<stage>/seg_*.png` + `stars.png` — segment + parallax images

## Dependencies on foundation

```js
// state.js
state.scroll = 0;                  // distance scrolled along the axis (px)
state.player = { x, y, w, h, ... };
```

Constants from `constants.js`: `VIEW.w`, `VIEW.h`. For a vertical shmup the
viewport is typically portrait (e.g. 720×1280); horizontal is landscape.

## Level data — layers + scroll (data/<stage>.json)

Matches `genres/shmup.md`. `tileMode: "segments"` for the main ground;
`tileMode: "loop"` for a single-image repeating secondary layer. Every layer has
an `id` (per `common.md` JSON entry contract).

```json
{
  "id": "stage_1",
  "scrollAxis": "vertical",
  "scrollSpeed": 80,
  "viewport": { "width": 720, "height": 1280 },
  "playerSpawn": { "x": 360, "y": 1100 },
  "playerBounds": { "x": 0, "y": 600, "w": 720, "h": 680 },
  "layers": [
    { "id": "stars_far", "image": "assets/maps/stage1/stars.png",
      "tileMode": "loop", "parallax": 0.15, "zIndex": 0 },
    { "id": "ground", "tileMode": "segments", "parallax": 0.55, "zIndex": 1,
      "segmentImages": [
        "assets/maps/stage1/seg_field.png",
        "assets/maps/stage1/seg_forest.png",
        "assets/maps/stage1/seg_castle_approach.png"
      ] }
  ]
}
```

> Keep it to **2 layers max** for shmup — the action has too much going on for
> the player to register more (per `genres/shmup.md`). 3-5 segments on the main
> `ground` layer gives clear environmental progression.

Each segment image is **one camera-length** along the scroll axis: for a vertical
stage, `segmentH = viewport.height`; for horizontal, `segmentW = viewport.width`.

## Pattern

### 1. Advance the scroll at a fixed speed

The world moves; the camera doesn't lerp or follow. `state.scroll` is the total
distance travelled — everything (segments, parallax, optionally enemy paths)
derives from it.

```js
// src/stages.js
let SCROLL_AXIS, SCROLL_SPEED, BOUNDS, SEG_LEN;

function initStage(level) {
  SCROLL_AXIS = level.scrollAxis;
  SCROLL_SPEED = level.scrollSpeed;
  BOUNDS = level.playerBounds;
  SEG_LEN = SCROLL_AXIS === "vertical" ? VIEW.h : VIEW.w;
}

function updateScroll(dt) {
  state.scroll += SCROLL_SPEED * dt;   // monotonic; never resets
}
```

### 2. Clamp the player to a sub-rectangle (not the whole screen)

`playerBounds` leaves room ahead of the player for enemies to fly in. The player
can dodge but never escape the scroll (per `genres/shmup.md` §Camera).

```js
function clampPlayer() {
  const p = state.player;
  p.x = clamp(p.x, BOUNDS.x, BOUNDS.x + BOUNDS.w - p.w);
  p.y = clamp(p.y, BOUNDS.y, BOUNDS.y + BOUNDS.h - p.h);
}
```

### 3. Draw — back-to-front, each layer at its own parallax

A layer's effective scroll = `state.scroll * parallax`. Distant layers (low
parallax) drift slowly; the `ground` layer (0.55) moves fast.

```js
// src/render.js
function drawScrollingBg(ctx, level) {
  const layers = (level.layers || []).slice().sort((a, b) => (a.zIndex || 0) - (b.zIndex || 0));
  for (const layer of layers) {
    const off = state.scroll * (layer.parallax ?? 1);
    if (layer.tileMode === "segments") drawSegments(ctx, layer, off);
    else drawLooping(ctx, layer, off);     // "loop" (single repeating image)
  }
}
```

### 4. Segmented draw — pick the right panel(s) by scroll distance

The visible window spans `[off, off + viewportLen]`. Figure out which segment
index the window's leading edge is in, and draw that segment plus the next
(so the seam between two segments scrolls through smoothly). When the scroll
passes the last segment, **clamp to the final segment** (the stage approaches the
boss — don't wrap back to the field).

```js
function drawSegments(ctx, layer, off) {
  const imgs = layer.segmentImages.map(p => assetCache.images.get(p));
  const lastIdx = imgs.length - 1;
  // index of the segment occupying the leading edge of the viewport:
  const baseIdx = Math.floor(off / SEG_LEN);
  // draw the current segment and the one after it (covers the seam)
  for (let k = 0; k <= 1; k++) {
    const idx = Math.min(baseIdx + k, lastIdx);   // clamp at the final segment
    const img = imgs[idx];
    if (!img || img instanceof Promise) continue;
    // screen position: where this segment's top/left sits after scrolling
    const segStart = (baseIdx + k) * SEG_LEN - off;
    if (SCROLL_AXIS === "vertical") {
      ctx.drawImage(img, 0, Math.round(segStart), VIEW.w, SEG_LEN);
    } else {
      ctx.drawImage(img, Math.round(segStart), 0, SEG_LEN, VIEW.h);
    }
  }
}
```

> Note `segStart` uses `(baseIdx + k)`, not the clamped `idx` — so once you hit
> the last segment it stays pinned filling the screen, instead of sliding off
> and leaving a gap.

### 5. Looping draw — single tileable image, modulo wrap

For the secondary parallax layer (stars / clouds): one image repeated with a
modulo offset, exactly like side-scroll parallax but driven by `state.scroll`
instead of camera x.

```js
function drawLooping(ctx, layer, off) {
  const img = assetCache.images.get(layer.image);
  if (!img || img instanceof Promise) return;
  if (SCROLL_AXIS === "vertical") {
    const o = ((off % img.height) + img.height) % img.height;  // positive modulo
    for (let y = o - img.height; y < VIEW.h + img.height; y += img.height) {
      ctx.drawImage(img, 0, Math.round(y), VIEW.w, img.height);
    }
  } else {
    const o = ((off % img.width) + img.width) % img.width;
    for (let x = o - img.width; x < VIEW.w + img.width; x += img.width) {
      ctx.drawImage(img, Math.round(x), 0, img.width, VIEW.h);
    }
  }
}
```

### 6. Stage progression hook (segment → wave/boss timing)

`state.scroll / (SEG_LEN * segmentCount)` gives a 0..1 stage-progress value the
wave director or HUD can read (e.g. "boss appears as we enter the final
segment"). Keep wave timing in `waves.js`; the bg just exposes progress.

```js
function stageProgress(level) {
  const total = SEG_LEN * level.layers.find(l => l.tileMode === "segments").segmentImages.length;
  return clamp(state.scroll / total, 0, 1);
}
```

## Adaptation knobs

| Knob | Where | Effect |
|---|---|---|
| `scrollAxis` | stage JSON | `vertical` (Galaga) / `horizontal` (R-Type) |
| `scrollSpeed` | stage JSON | Level pacing (px/s); faster = more frantic |
| `playerBounds` | stage JSON | Player's box; leaves room ahead for spawns |
| `segmentImages[]` | stage JSON | 3-5 panels = clear terrain progression |
| `parallax` per layer | stage JSON | Drift speed (0.15 stars, 0.55 ground) |
| layer count | stage JSON | 2 max for shmup; more clutters the action |

## Common mistakes

1. **Single repeating tile for the main stage** — the screen visibly moves but
   the same image keeps coming back, so the brain reads "no progress" and the
   player feels stuck. Use `tileMode: "segments"` with 3-5 distinct panels. (The
   #1 shmup feel-bug, per `genres/shmup.md`.)
2. **Wrapping back to segment 0 after the last segment** — the stage "loops"
   forever and the boss approach never arrives. Clamp `idx` at the final segment
   so it pins on screen.
3. **Negative modulo seam** — `off % len` is negative when scroll math goes the
   other way (or for horizontal scroll), leaving a 1px gap or a jump. Use the
   positive-modulo form `((off % len) + len) % len`.
4. **Player clamped to the full viewport** — the player can sit on the spawn
   edge with no room for enemies to enter ahead. Clamp to `playerBounds`, a
   sub-rectangle.
5. **Stretching a segment to the wrong length** — segment image must be one
   camera-length along the scroll axis (`viewport.height` vertical /
   `viewport.width` horizontal). A mismatched size produces a visible seam every
   segment.
6. **>2 layers** — readability dies; the player can't track bullets against busy
   multi-layer scenery. Cap at ground + one parallax layer.
7. **Using `background.tile` (arena-survivor shape) for the scrolling stage** —
   that's the single-tile camera-follow pattern; it produces exactly mistake #1.
   Shmup uses `layers[]` with segments.
8. **Resetting `state.scroll` on segment change** — segment positions are
   derived from a monotonic `state.scroll`; resetting it snaps the bg. Let scroll
   grow forever; derive segment index by `floor(off / SEG_LEN)`.

## Reference

- `genres/shmup.md` §"Background — segmented progression, NOT single tile",
  §"Camera — autoscroll, fixed speed" — the schema + feel-bug warning this
  recipe implements.
- `recipes/side-scroll/parallax-layers.md` — the looping-layer modulo-wrap
  technique (here driven by `state.scroll`, there by camera x).
- `common.md` §"Background dimensions" — single-image vs tileable sizing rules.

## Files NOT in this recipe

- Bullets that fly over the background → `recipes/shmup/bullet-patterns.md`
- Enemy waves + formations timed to stage progress → `recipes/shmup/enemy-waves.md`
- Boss-arena static background → use `background: { image }` (see When NOT to use)
