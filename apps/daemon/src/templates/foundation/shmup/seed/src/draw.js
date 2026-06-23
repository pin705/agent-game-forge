// draw.js — shared visual-polish primitives (vanilla canvas, zero deps).
// Load BEFORE render.js. These turn flat rects into shapes with depth (shadow),
// energy (glow), and softness (rounded corners) so even a pre-art seed reads as a
// real game instead of placeholder boxes. Keep using fillRect for hot bulk draws;
// reach for these on the things the eye lands on (player, enemies, HUD, pickups).

function roundRectPath(ctx, x, y, w, h, r) {
  r = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function fillRoundRect(ctx, x, y, w, h, r, color) {
  roundRectPath(ctx, x, y, w, h, r);
  ctx.fillStyle = color;
  ctx.fill();
}

// A rounded body with a drop shadow, an optional vertical gradient, an optional
// glow (colored bloom), and an optional outline. The workhorse for entities/cards.
function softShape(ctx, x, y, w, h, r, fill, opts) {
  opts = opts || {};
  ctx.save();
  if (opts.shadow !== false) {
    ctx.shadowColor = opts.shadow || "rgba(0,0,0,0.45)";
    ctx.shadowBlur = opts.shadowBlur != null ? opts.shadowBlur : 10;
    ctx.shadowOffsetY = opts.shadowOffsetY != null ? opts.shadowOffsetY : 4;
  }
  if (opts.glow) { ctx.shadowColor = opts.glow; ctx.shadowBlur = opts.glowBlur || 18; ctx.shadowOffsetY = 0; }
  roundRectPath(ctx, x, y, w, h, r);
  if (opts.gradTop && opts.gradBottom) {
    var g = ctx.createLinearGradient(x, y, x, y + h);
    g.addColorStop(0, opts.gradTop); g.addColorStop(1, opts.gradBottom);
    ctx.fillStyle = g;
  } else {
    ctx.fillStyle = fill;
  }
  ctx.fill();
  ctx.restore();
  if (opts.stroke) {
    roundRectPath(ctx, x + 0.5, y + 0.5, w - 1, h - 1, r);
    ctx.strokeStyle = opts.stroke;
    ctx.lineWidth = opts.lineWidth || 2;
    ctx.stroke();
  }
  if (opts.highlight !== false) {
    // subtle top sheen so the shape feels lit from above
    ctx.save();
    roundRectPath(ctx, x + w * 0.15, y + h * 0.08, w * 0.7, h * 0.28, Math.min(r, h * 0.14));
    ctx.fillStyle = "rgba(255,255,255,0.10)";
    ctx.fill();
    ctx.restore();
  }
}

// Glowing filled circle — projectiles, XP gems, sparks.
function glowDot(ctx, x, y, radius, color, glowBlur) {
  ctx.save();
  ctx.shadowColor = color;
  ctx.shadowBlur = glowBlur != null ? glowBlur : radius * 2.2;
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(x, y, radius, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

// Radial vignette / ambience over the whole viewport.
function vignette(ctx, w, h, innerColor, outerColor) {
  var g = ctx.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.18, w / 2, h / 2, Math.max(w, h) * 0.72);
  g.addColorStop(0, innerColor);
  g.addColorStop(1, outerColor);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
}

// Pill-shaped stat bar with a left→right gradient fill + dark track.
function gradientBar(ctx, x, y, w, h, pct, c0, c1, track) {
  pct = Math.max(0, Math.min(1, pct));
  fillRoundRect(ctx, x, y, w, h, h / 2, track || "rgba(0,0,0,0.5)");
  if (pct > 0) {
    var g = ctx.createLinearGradient(x, y, x + w, y);
    g.addColorStop(0, c0); g.addColorStop(1, c1);
    fillRoundRect(ctx, x, y, Math.max(h, w * pct), h, h / 2, g);
  }
}

// Crisp text with a soft dark outline so it reads over any background.
function crispText(ctx, text, x, y, font, color, align) {
  ctx.save();
  ctx.font = font;
  ctx.textAlign = align || "left";
  ctx.lineJoinp = "round";
  ctx.lineWidth = 3;
  ctx.strokeStyle = "rgba(0,0,0,0.55)";
  ctx.strokeText(text, x, y);
  ctx.fillStyle = color;
  ctx.fillText(text, x, y);
  ctx.restore();
}
