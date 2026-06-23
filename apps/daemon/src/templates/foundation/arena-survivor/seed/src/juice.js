// juice.js — the game-feel layer (vanilla, zero deps). Global-script style:
// shares `state`. Load AFTER state.js, BEFORE entity files. This is the studio's
// reusable polish core (the vanilla answer to OpenGame's ScreenEffectHelper).
//
// It provides what particles.js + screenshake() do NOT: easing curves, tweens,
// floating damage numbers, hit-stop (freeze-frame), motion trails, and combo
// escalation. Mandated by .ogf/conventions/juice.md — every game wires
// updateJuice(dt) + drawJuice(ctx) into its loop and reaches for these on every
// hit / death / pickup so the game FEELS alive instead of merely correct.
//
// All helpers guard their state with `??=` so they are robust to load order.

// --- Easing (t in 0..1 → eased 0..1) ---------------------------------------
const ease = {
  linear: (t) => t,
  inQuad: (t) => t * t,
  outQuad: (t) => 1 - (1 - t) * (1 - t),
  inOutQuad: (t) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2),
  outCubic: (t) => 1 - Math.pow(1 - t, 3),
  inOutCubic: (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2),
  // overshoot — great for pop-in UI, ability wind-ups
  outBack: (t) => {
    const c1 = 1.70158, c3 = c1 + 1;
    return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
  },
  // springy — selection cursors, reward pops
  outElastic: (t) => {
    const c4 = (2 * Math.PI) / 3;
    return t === 0 ? 0 : t === 1 ? 1 : Math.pow(2, -10 * t) * Math.sin((t * 10 - 0.75) * c4) + 1;
  },
  // bouncy — landings, drops
  outBounce: (t) => {
    const n1 = 7.5625, d1 = 2.75;
    if (t < 1 / d1) return n1 * t * t;
    if (t < 2 / d1) return n1 * (t -= 1.5 / d1) * t + 0.75;
    if (t < 2.5 / d1) return n1 * (t -= 2.25 / d1) * t + 0.9375;
    return n1 * (t -= 2.625 / d1) * t + 0.984375;
  },
};

// --- Tweens — animate numeric props over time ------------------------------
// tween(target, {prop: toValue, ...}, durSeconds, easeName?, onDone?)
// e.g. tween(door, { y: door.y - 64 }, 0.4, "outBack")
function tween(target, props, dur, easeName, onDone) {
  if (easeName === undefined) easeName = "outQuad";
  (state.tweens = state.tweens || []).push({
    target: target,
    dur: Math.max(0.0001, dur),
    t: 0,
    ease: ease[easeName] || ease.outQuad,
    onDone: onDone,
    from: Object.fromEntries(Object.keys(props).map(function(k) { return [k, target[k] !== undefined ? target[k] : 0]; })),
    to: props,
  });
}
function updateTweens(dt) {
  const tw = (state.tweens = state.tweens || []);
  for (const a of tw) {
    a.t = Math.min(1, a.t + dt / a.dur);
    const e = a.ease(a.t);
    for (const k in a.to) a.target[k] = a.from[k] + (a.to[k] - a.from[k]) * e;
    if (a.t >= 1 && a.onDone) a.onDone();
  }
  state.tweens = tw.filter((a) => a.t < 1);
}

// --- Floating text — damage numbers, "+1 block", pickups -------------------
// floater(text, x, y, opts?). x,y are in the space you draw HUD/scene; for a
// camera-offset world pass screen coords (sx(x), sy(y)). Combat reads better
// when crits/heals get their own color + bigger size.
function floater(text, x, y, opts) {
  var o = opts || {};
  (state.floaters = state.floaters || []).push({
    text: String(text),
    x: x,
    y: y,
    vy: o.vy !== undefined ? o.vy : -46,
    life: o.life !== undefined ? o.life : 0.9,
    maxLife: o.life !== undefined ? o.life : 0.9,
    color: o.color !== undefined ? o.color : "#ffffff",
    size: (o.size !== undefined ? o.size : 18) * comboMul(),
    drift: (Math.random() * 2 - 1) * (o.drift !== undefined ? o.drift : 12),
  });
}
function updateFloaters(dt) {
  const fl = (state.floaters = state.floaters || []);
  for (const f of fl) {
    f.life -= dt;
    f.y += f.vy * dt;
    f.x += f.drift * dt;
    f.vy += 34 * dt; // gentle gravity so they arc
  }
  state.floaters = fl.filter((f) => f.life > 0);
}
function drawFloaters(ctx) {
  const fl = state.floaters || [];
  if (!fl.length) return;
  ctx.save();
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  for (const f of fl) {
    ctx.globalAlpha = Math.min(1, f.life / (f.maxLife * 0.5));
    ctx.font = `bold ${Math.round(f.size)}px system-ui, sans-serif`;
    ctx.lineWidth = 3;
    ctx.strokeStyle = "rgba(0,0,0,0.6)";
    ctx.strokeText(f.text, f.x, f.y);
    ctx.fillStyle = f.color;
    ctx.fillText(f.text, f.x, f.y);
  }
  ctx.restore();
}

// --- Hit-stop — the freeze-frame that gives impacts weight ------------------
// Call hitstop(0.05) on a solid hit, hitstop(0.12) on a kill/special. The frame
// loop must zero GAMEPLAY dt while state.hitstop > 0 (FX + render keep running):
//   const sdt = state.hitstop > 0 ? 0 : dt;  updateScene(sdt);  updateJuice(dt);
function hitstop(sec) {
  state.hitstop = Math.max(state.hitstop !== undefined ? state.hitstop : 0, sec);
}

// --- Motion trails — ghost images for dashes & fast projectiles ------------
// ghost(x, y, img, opts?). Drop several along a dash (stagger by frame) for a
// streak. img may be null → a soft colored blob (good for magic/projectiles).
function ghost(x, y, img, opts) {
  var o = opts || {};
  (state.trails = state.trails || []).push({
    x: x,
    y: y,
    img: img !== undefined ? img : null,
    w: o.w !== undefined ? o.w : 32,
    h: o.h !== undefined ? o.h : 32,
    life: o.life !== undefined ? o.life : 0.25,
    maxLife: o.life !== undefined ? o.life : 0.25,
    color: o.color !== undefined ? o.color : "rgba(120,180,255,0.5)",
    scale: o.scale !== undefined ? o.scale : 1,
    endScale: o.endScale !== undefined ? o.endScale : 1.25,
  });
}
function updateTrails(dt) {
  const tr = (state.trails = state.trails || []);
  for (const g of tr) g.life -= dt;
  state.trails = tr.filter((g) => g.life > 0);
}
function drawTrails(ctx) {
  const tr = state.trails || [];
  if (!tr.length) return;
  ctx.save();
  for (const g of tr) {
    const k = g.life / g.maxLife; // 1 → 0
    const s = g.scale + (g.endScale - g.scale) * (1 - k);
    ctx.globalAlpha = k * 0.6;
    if (g.img) {
      ctx.drawImage(g.img, g.x - (g.w * s) / 2, g.y - (g.h * s) / 2, g.w * s, g.h * s);
    } else {
      ctx.fillStyle = g.color;
      ctx.beginPath();
      ctx.arc(g.x, g.y, (g.w * s) / 2, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  ctx.restore();
}

// --- Combo escalation — a 5-hit chain should FEEL bigger than a 1-hit -------
// bumpCombo() on each chained hit; comboMul() scales shake/particles/floater so
// feedback grows with the streak. Resets after `window` seconds of no hits.
function bumpCombo(window) {
  if (window === undefined) window = 1.2;
  state.combo = (state.combo !== undefined ? state.combo : 0) + 1;
  state.comboT = window;
}
function comboMul() {
  return 1 + Math.min(state.combo !== undefined ? state.combo : 0, 8) * 0.12; // 1.0 → 1.96 at 8+ hits
}
function updateCombo(dt) {
  if ((state.comboT !== undefined ? state.comboT : 0) > 0) {
    state.comboT -= dt;
    if (state.comboT <= 0) state.combo = 0;
  }
}

// --- Hurt flash — white-out a sprite the moment it's hit --------------------
// In render: const a = hurtFlash(enemy.hurtTimer); if (a) draw a white overlay
// (globalAlpha=a + 'lighter') over the sprite. Pairs with enemy.hurtTimer.
function hurtFlash(timer, dur) {
  if (dur === undefined) dur = 0.18;
  return timer > 0 ? Math.min(1, timer / dur) * 0.8 : 0;
}

// --- Lifecycle — call these from your frame loop ----------------------------
function updateJuice(dt) {
  updateTweens(dt);
  updateFloaters(dt);
  updateTrails(dt);
  updateCombo(dt);
}
function drawJuice(ctx) {
  drawTrails(ctx);
  drawFloaters(ctx);
}
