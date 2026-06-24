// Scrolling parallax starfield (scrolling-bg recipe, asset-free variant). Two
// depth bands of pooled dots fall downward at different speeds → depth illusion
// without any image. Dots wrap to the top when they pass the bottom edge.
const STAR_COUNT = 140;

function initStars() {
  state.stars.length = 0;
  for (let i = 0; i < STAR_COUNT; i += 1) {
    state.stars.push(makeStar(Math.random() * VIEW.h));
  }
}

function makeStar(y) {
  const far = Math.random() < 0.6;
  return {
    x: Math.random() * VIEW.w,
    y,
    speed: far ? 40 + Math.random() * 30 : 120 + Math.random() * 90, // parallax bands
    size: far ? 1 : 2,
    alpha: far ? 0.4 + Math.random() * 0.3 : 0.7 + Math.random() * 0.3
  };
}

function updateStars(dt) {
  for (const s of state.stars) {
    s.y += s.speed * dt;
    if (s.y > VIEW.h + 2) {
      // recycle: re-seed at the top with fresh band/x (pooled, no allocation churn)
      const ns = makeStar(-2);
      s.x = ns.x; s.y = -2; s.speed = ns.speed; s.size = ns.size; s.alpha = ns.alpha;
    }
  }
}

function drawStars(ctx) {
  ctx.save();
  for (const s of state.stars) {
    ctx.globalAlpha = s.alpha;
    ctx.fillStyle = COLORS.star;
    ctx.fillRect(s.x, s.y, s.size, s.size);
  }
  ctx.restore();
}
