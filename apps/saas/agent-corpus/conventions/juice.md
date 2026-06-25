# Juice — the game-feel layer (MANDATORY)

> The difference between a game that is *correct* and a game that feels *good* is
> juice: the screen shake, the freeze-frame, the floating damage number, the
> particle burst, the easing on every motion. A game where the hit "just
> happens" reads as a prototype. This file is the rule that makes every OGF game
> feel alive — the vanilla-Canvas answer to a mature engine's effects layer.
>
> **This is not optional.** Every game ships `src/juice.js`, wires it into the
> frame loop, and reaches for it on every hit / death / pickup / transition.
> A static verifier checks the wiring (see `verification.md`).

---

## The rule

1. **Ship `src/juice.js`.** The scaffold already includes it; the per-genre
   foundation seeds already wire it. If you build a genre from scratch, copy the
   source at the bottom of this file into `src/juice.js`.
2. **Wire the loop** — every frame, after gameplay update and after render:
   ```js
   // global-seed style (side-scroll / top-down-rpg / most action genres)
   if (state.hitstop > 0) state.hitstop = Math.max(0, state.hitstop - dt);
   const sdt = state.hitstop > 0 ? 0 : dt;   // gameplay freezes; FX keep running
   updateScene(sdt);
   updateParticles(dt);
   updateJuice(dt);
   renderFrame();
   drawJuice(ctx);                            // floating text + trails on top
   ```
   Turn-based genres may skip the `sdt` freeze, but still call
   `updateJuice(dt)` + `drawJuice(ctx)`.
3. **Reach for it on every game event** — see the checklist below. This is what
   "use the juice layer" means concretely.

---

## Per-event checklist (do these — this is the mandate)

| Event | What to fire | Why |
|---|---|---|
| **Enemy hit** | `screenshake(4 * comboMul(), 0.1)` · `burstParticles(e.x, e.y, 8, COLORS.gold)` · `hitstop(0.04)` · `floater(dmg, e.x, e.y - 20, {color:'#ffd23f'})` · `bumpCombo()` · `e.hurtTimer = 0.18` | Impact weight + readable damage |
| **Enemy killed** | `screenshake(7, 0.14)` · `burstParticles(e.x, e.y, 16)` · `hitstop(0.1)` · death `floater` / loot | A kill must feel bigger than a hit |
| **Player takes damage** | `screenshake(6, 0.12)` · white `hurtFlash` overlay · `hitstop(0.05)` · brief invuln blink | Sells the threat, gives i-frames feedback |
| **Pickup / coin / heal** | `floater('+' + n, x, y, {color:'#7CFC00'})` · 3–4 sparkle particles | Reward legibility |
| **Level up / unlock** | `tween(badge, {scale: 1.3}, 0.3, 'outBack')` then back · burst · `floater('LEVEL UP', ...)` | Celebrate progression |
| **Dash / dodge / fast projectile** | `ghost(x, y, sprite)` staggered along the path | Speed reads as a streak |
| **Landing (platformer)** | `screenshake(2, 0.06)` · dust `burstParticles(x, footY, 4, COLORS.smoke)` | Weight on touchdown |
| **Menu open / selection** | `tween(panel, {y: targetY}, 0.25, 'outBack')` · pulse cursor with `outElastic` | UI that breathes |
| **Scene / battle transition** | `tween` a fade/wipe alpha with `inOutQuad` | No hard cuts |

If a hit fires none of these, it is not done.

---

## Tuning presets (consistency across the whole game)

**Screen shake** `screenshake(intensity, seconds)` — keep it tiered, never random:
- Light `(2, 0.06)` — footsteps, landings, minor pings
- Medium `(4, 0.10)` — standard attacks, hits (scale by `comboMul()`)
- Strong `(7, 0.14)` — kills, player damage, boss slams

**Hit-stop** `hitstop(seconds)` — tiny numbers; more than ~0.12 feels laggy:
- Light `0.04` — normal hit · Medium `0.08` — heavy hit · Heavy `0.12` — kill / special

**Floater colors** — damage `#ffd23f`, crit `#ff5d5d`, heal/coin `#7CFC00`, block `#8ad`.

---

## API reference

Provided by `juice.js` (this file): `ease.{linear,outQuad,inOutQuad,outCubic,outBack,outElastic,outBounce}` ·
`tween(target, props, dur, easeName?, onDone?)` · `floater(text, x, y, opts?)` ·
`hitstop(sec)` · `ghost(x, y, img, opts?)` · `bumpCombo(window?)` · `comboMul()` ·
`hurtFlash(timer, dur?)` · `updateJuice(dt)` · `drawJuice(ctx)`.

Provided by `particles.js` (already in the seeds): `screenshake(intensity, sec)` ·
`burstParticles(x, y, count, color?)` · `spawnParticle(x, y, opts?)`.

> `floater`/`drawJuice` draw in the coordinate space you pass. For a
> camera-offset world, pass screen coords (e.g. `sx(x), sy(y)`).

---

## Drop-in source (for a genre with no seed)

Copy verbatim into `src/juice.js`, load it **after** `state.js` and **before**
your entity files (`<script src="src/juice.js"></script>`):

```js
// juice.js — game-feel layer (vanilla, zero deps). Shares global `state`.
const ease = {
  linear: (t) => t,
  inQuad: (t) => t * t,
  outQuad: (t) => 1 - (1 - t) * (1 - t),
  inOutQuad: (t) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2),
  outCubic: (t) => 1 - Math.pow(1 - t, 3),
  inOutCubic: (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2),
  outBack: (t) => { const c1 = 1.70158, c3 = c1 + 1; return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2); },
  outElastic: (t) => { const c4 = (2 * Math.PI) / 3; return t === 0 ? 0 : t === 1 ? 1 : Math.pow(2, -10 * t) * Math.sin((t * 10 - 0.75) * c4) + 1; },
  outBounce: (t) => { const n1 = 7.5625, d1 = 2.75; if (t < 1 / d1) return n1 * t * t; if (t < 2 / d1) return n1 * (t -= 1.5 / d1) * t + 0.75; if (t < 2.5 / d1) return n1 * (t -= 2.25 / d1) * t + 0.9375; return n1 * (t -= 2.625 / d1) * t + 0.984375; },
};
function tween(target, props, dur, easeName = "outQuad", onDone) {
  (state.tweens ??= []).push({ target, dur: Math.max(1e-4, dur), t: 0, ease: ease[easeName] || ease.outQuad, onDone,
    from: Object.fromEntries(Object.keys(props).map((k) => [k, target[k] ?? 0])), to: props });
}
function updateTweens(dt) {
  const tw = (state.tweens ??= []);
  for (const a of tw) { a.t = Math.min(1, a.t + dt / a.dur); const e = a.ease(a.t); for (const k in a.to) a.target[k] = a.from[k] + (a.to[k] - a.from[k]) * e; if (a.t >= 1 && a.onDone) a.onDone(); }
  state.tweens = tw.filter((a) => a.t < 1);
}
function floater(text, x, y, opts = {}) {
  (state.floaters ??= []).push({ text: String(text), x, y, vy: opts.vy ?? -46, life: opts.life ?? 0.9, maxLife: opts.life ?? 0.9,
    color: opts.color ?? "#fff", size: (opts.size ?? 18) * comboMul(), drift: (Math.random() * 2 - 1) * (opts.drift ?? 12) });
}
function updateFloaters(dt) {
  const fl = (state.floaters ??= []);
  for (const f of fl) { f.life -= dt; f.y += f.vy * dt; f.x += f.drift * dt; f.vy += 34 * dt; }
  state.floaters = fl.filter((f) => f.life > 0);
}
function drawFloaters(ctx) {
  const fl = state.floaters ?? []; if (!fl.length) return;
  ctx.save(); ctx.textAlign = "center"; ctx.textBaseline = "middle";
  for (const f of fl) { ctx.globalAlpha = Math.min(1, f.life / (f.maxLife * 0.5)); ctx.font = `bold ${Math.round(f.size)}px system-ui, sans-serif`; ctx.lineWidth = 3; ctx.strokeStyle = "rgba(0,0,0,0.6)"; ctx.strokeText(f.text, f.x, f.y); ctx.fillStyle = f.color; ctx.fillText(f.text, f.x, f.y); }
  ctx.restore();
}
function hitstop(sec) { state.hitstop = Math.max(state.hitstop ?? 0, sec); }
function ghost(x, y, img, opts = {}) {
  (state.trails ??= []).push({ x, y, img: img ?? null, w: opts.w ?? 32, h: opts.h ?? 32, life: opts.life ?? 0.25, maxLife: opts.life ?? 0.25, color: opts.color ?? "rgba(120,180,255,0.5)", scale: opts.scale ?? 1, endScale: opts.endScale ?? 1.25 });
}
function updateTrails(dt) { const tr = (state.trails ??= []); for (const g of tr) g.life -= dt; state.trails = tr.filter((g) => g.life > 0); }
function drawTrails(ctx) {
  const tr = state.trails ?? []; if (!tr.length) return; ctx.save();
  for (const g of tr) { const k = g.life / g.maxLife, s = g.scale + (g.endScale - g.scale) * (1 - k); ctx.globalAlpha = k * 0.6; if (g.img) ctx.drawImage(g.img, g.x - (g.w * s) / 2, g.y - (g.h * s) / 2, g.w * s, g.h * s); else { ctx.fillStyle = g.color; ctx.beginPath(); ctx.arc(g.x, g.y, (g.w * s) / 2, 0, Math.PI * 2); ctx.fill(); } }
  ctx.restore();
}
function bumpCombo(window = 1.2) { state.combo = (state.combo ?? 0) + 1; state.comboT = window; }
function comboMul() { return 1 + Math.min(state.combo ?? 0, 8) * 0.12; }
function updateCombo(dt) { if ((state.comboT ?? 0) > 0) { state.comboT -= dt; if (state.comboT <= 0) state.combo = 0; } }
function hurtFlash(timer, dur = 0.18) { return timer > 0 ? Math.min(1, timer / dur) * 0.8 : 0; }
function updateJuice(dt) { updateTweens(dt); updateFloaters(dt); updateTrails(dt); updateCombo(dt); }
function drawJuice(ctx) { drawTrails(ctx); drawFloaters(ctx); }
```

Remember to add the matching `state` fields (`floaters`, `tweens`, `trails`,
`hitstop`, `combo`, `comboT`) and reset them on new-run.
