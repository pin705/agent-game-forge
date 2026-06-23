// mobile.js — touch controls + mobile-first input (vanilla, zero deps).
// Left half of the screen is a floating virtual joystick (feeds the SAME action
// system as keys/gamepad, so gameplay code needs no per-input changes). Right-half
// tap acts as the universal "action" (start/confirm/jump/attack/interact). The
// joystick + a hint are drawn on the canvas, only on touch devices.
//
// Wiring: load after dom.js; call initMobile() in boot(); updateInput() merges
// TOUCH (see input.js); call drawMobileControls(dom.ctx) at the end of the frame.

var TOUCH = { isTouch: false, active: false, left: false, right: false, up: false, down: false, x: 0, y: 0,
  start: false, _startEdge: false, joyId: null, cx: 0, cy: 0, jx: 0, jy: 0 };

function initMobile() {
  TOUCH.isTouch = (typeof window !== "undefined") && (("ontouchstart" in window) || (navigator.maxTouchPoints || 0) > 0);
  var c = dom.canvas;
  if (!c || !c.addEventListener) return;
  function toCanvas(touch) {
    var r = c.getBoundingClientRect();
    return { x: (touch.clientX - r.left) * (c.width / r.width), y: (touch.clientY - r.top) * (c.height / r.height) };
  }
  c.addEventListener("touchstart", function (e) {
    TOUCH.isTouch = true;
    for (var i = 0; i < e.changedTouches.length; i++) {
      var tch = e.changedTouches[i], p = toCanvas(tch);
      if (p.x < c.width * 0.5 && TOUCH.joyId === null) {
        TOUCH.joyId = tch.identifier; TOUCH.cx = p.x; TOUCH.cy = p.y; TOUCH.jx = p.x; TOUCH.jy = p.y; TOUCH.active = true;
      } else {
        TOUCH._startEdge = true; // right-half tap = action
      }
    }
    if (e.cancelable) e.preventDefault();
  }, { passive: false });
  c.addEventListener("touchmove", function (e) {
    for (var i = 0; i < e.changedTouches.length; i++) {
      var tch = e.changedTouches[i];
      if (tch.identifier === TOUCH.joyId) { var p = toCanvas(tch); TOUCH.jx = p.x; TOUCH.jy = p.y; }
    }
    if (e.cancelable) e.preventDefault();
  }, { passive: false });
  function endTouch(e) {
    for (var i = 0; i < e.changedTouches.length; i++) {
      if (e.changedTouches[i].identifier === TOUCH.joyId) { TOUCH.joyId = null; TOUCH.active = false; }
    }
  }
  c.addEventListener("touchend", endTouch);
  c.addEventListener("touchcancel", endTouch);
  if (typeof ensureAudio === "function") c.addEventListener("touchstart", ensureAudio, { passive: true });
}

// Call once per updateInput(): resolves the joystick offset into direction booleans
// + a -1..1 x axis, and edge-detects the action tap.
function updateMobileAxis() {
  if (TOUCH.joyId !== null) {
    var dx = TOUCH.jx - TOUCH.cx, dy = TOUCH.jy - TOUCH.cy;
    var dead = 12, max = 70;
    var lx = Math.abs(dx) > dead ? Math.max(-1, Math.min(1, dx / max)) : 0;
    var ly = Math.abs(dy) > dead ? Math.max(-1, Math.min(1, dy / max)) : 0;
    TOUCH.x = lx;
    TOUCH.left = lx < -0.3; TOUCH.right = lx > 0.3;
    TOUCH.up = ly < -0.3; TOUCH.down = ly > 0.3;
  } else {
    TOUCH.x = 0; TOUCH.left = TOUCH.right = TOUCH.up = TOUCH.down = false;
  }
  TOUCH.start = TOUCH._startEdge;
  TOUCH._startEdge = false;
}

function drawMobileControls(ctx) {
  if (!TOUCH.isTouch || !dom.canvas) return;
  var h = dom.canvas.height;
  ctx.save();
  if (TOUCH.joyId !== null) {
    ctx.globalAlpha = 0.5;
    ctx.beginPath(); ctx.arc(TOUCH.cx, TOUCH.cy, 46, 0, Math.PI * 2);
    ctx.fillStyle = "rgba(255,255,255,0.10)"; ctx.fill();
    ctx.strokeStyle = "rgba(255,255,255,0.30)"; ctx.lineWidth = 2; ctx.stroke();
    var dx = Math.max(-40, Math.min(40, TOUCH.jx - TOUCH.cx));
    var dy = Math.max(-40, Math.min(40, TOUCH.jy - TOUCH.cy));
    ctx.beginPath(); ctx.arc(TOUCH.cx + dx, TOUCH.cy + dy, 22, 0, Math.PI * 2);
    ctx.fillStyle = "rgba(255,255,255,0.38)"; ctx.fill();
  } else {
    ctx.globalAlpha = 0.16;
    ctx.beginPath(); ctx.arc(86, h - 86, 40, 0, Math.PI * 2);
    ctx.strokeStyle = "#ffffff"; ctx.lineWidth = 3; ctx.stroke();
  }
  ctx.restore();
}
