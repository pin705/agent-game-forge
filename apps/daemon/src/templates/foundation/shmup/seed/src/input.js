const input = {
  keys: new Set(),
  prev: {},
  actions: {},
  gamepadIndex: null
};

const KEY_BINDINGS = {
  left: ["ArrowLeft", "KeyA"],
  right: ["ArrowRight", "KeyD"],
  up: ["ArrowUp", "KeyW"],
  down: ["ArrowDown", "KeyS"],
  fire: ["Space", "KeyJ", "KeyK"],
  start: ["Enter", "NumpadEnter", "Space"],
  pause: ["Escape", "KeyP"]
};

function initInput() {
  window.addEventListener("keydown", (event) => {
    if (["Space", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(event.code)) {
      event.preventDefault();
    }
    input.keys.add(event.code);
  });
  window.addEventListener("keyup", (event) => input.keys.delete(event.code));
  window.addEventListener("gamepadconnected", (event) => {
    input.gamepadIndex = event.gamepad.index;
  });
  window.addEventListener("gamepaddisconnected", () => {
    input.gamepadIndex = null;
  });
}

function updateInput() {
  input.prev = input.actions;
  const gp = getGamepadState();
  const next = {};
  for (const name of Object.keys(KEY_BINDINGS)) {
    next[name] = KEY_BINDINGS[name].some((key) => input.keys.has(key)) || Boolean(gp[name]);
  }
  // analog/dpad axes → -1..1 for both axes (player moves 4-dir)
  next.ax = (gp.x !== 0 ? gp.x : 0) || ((next.right ? 1 : 0) - (next.left ? 1 : 0));
  next.ay = (gp.y !== 0 ? gp.y : 0) || ((next.down ? 1 : 0) - (next.up ? 1 : 0));
  input.actions = next;
}

function getGamepadState() {
  const pads = navigator.getGamepads ? navigator.getGamepads() : [];
  const pad = input.gamepadIndex != null ? pads[input.gamepadIndex] : Array.from(pads).find(Boolean);
  if (!pad) return { x: 0, y: 0 };
  const axisX = Math.abs(pad.axes[0] || 0) > 0.25 ? pad.axes[0] : 0;
  const axisY = Math.abs(pad.axes[1] || 0) > 0.25 ? pad.axes[1] : 0;
  return {
    x: axisX,
    y: axisY,
    left: axisX < -0.25 || pad.buttons[14]?.pressed,
    right: axisX > 0.25 || pad.buttons[15]?.pressed,
    up: axisY < -0.25 || pad.buttons[12]?.pressed,
    down: axisY > 0.25 || pad.buttons[13]?.pressed,
    fire: pad.buttons[0]?.pressed || pad.buttons[2]?.pressed,
    start: pad.buttons[9]?.pressed || pad.buttons[0]?.pressed,
    pause: pad.buttons[8]?.pressed
  };
}

function isHeld(action) {
  return Boolean(input.actions[action]);
}

function wasPressed(action) {
  return Boolean(input.actions[action]) && !input.prev[action];
}
