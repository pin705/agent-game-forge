// input.js — keyboard (start/pause/tower-select) + MOUSE (place towers). The
// canvas is CSS-scaled, so click/move coords are converted from offsetX/offsetY
// into the canvas's internal 1280x720 space. Shares global `state` + input.
const input = {
  keys: new Set(),
  prev: {},
  actions: {},
  mouse: { x: 0, y: 0, clicked: false, inside: false }
};

const KEY_BINDINGS = {
  start: ["Enter", "NumpadEnter", "Space"],
  one: ["Digit1"],
  two: ["Digit2"],
  three: ["Digit3"],
  next: ["KeyN"]
};

function initInput() {
  window.addEventListener("keydown", (event) => {
    if (["Space"].includes(event.code)) event.preventDefault();
    input.keys.add(event.code);
  });
  window.addEventListener("keyup", (event) => input.keys.delete(event.code));

  const canvas = dom.canvas;
  const toCanvas = (event) => {
    const rect = canvas.getBoundingClientRect();
    const sx = rect.width ? VIEW.w / rect.width : 1;
    const sy = rect.height ? VIEW.h / rect.height : 1;
    return { x: (event.clientX - rect.left) * sx, y: (event.clientY - rect.top) * sy };
  };
  canvas.addEventListener("mousemove", (event) => {
    const p = toCanvas(event);
    input.mouse.x = p.x;
    input.mouse.y = p.y;
    input.mouse.inside = true;
  });
  canvas.addEventListener("mouseleave", () => { input.mouse.inside = false; });
  canvas.addEventListener("mousedown", (event) => {
    const p = toCanvas(event);
    input.mouse.x = p.x;
    input.mouse.y = p.y;
    input.mouse.clicked = true;
    onPointer(p.x, p.y); // routed by game.js / build logic
  });
}

function updateInput() {
  input.prev = input.actions;
  const next = {};
  for (const name of Object.keys(KEY_BINDINGS)) {
    next[name] = KEY_BINDINGS[name].some((key) => input.keys.has(key));
  }
  input.actions = next;
  input.mouse.clicked = false;
}

function wasPressed(action) {
  return Boolean(input.actions[action]) && !input.prev[action];
}
