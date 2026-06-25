// input.js — discrete grid input. One PRESS = one intent (no held-key repeat):
// wasPressed() is true only on the edge, so an arrow held down does not auto-step.
// Mirrors the side-scroll seed's edge-detect model (keys Set + prev/actions diff).

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
  undo: ["KeyZ", "Backspace"],
  reset: ["KeyR"],
  start: ["Enter", "NumpadEnter", "Space"],
  pause: ["Escape", "KeyP"]
};

function initInput() {
  window.addEventListener("keydown", (event) => {
    if (["Space", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Backspace"].includes(event.code)) {
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
  input.actions = next;
}

function getGamepadState() {
  const pads = navigator.getGamepads ? navigator.getGamepads() : [];
  const pad = input.gamepadIndex != null ? pads[input.gamepadIndex] : Array.from(pads).find(Boolean);
  if (!pad) return {};
  const ax = pad.axes[0] || 0, ay = pad.axes[1] || 0;
  return {
    left: ax < -0.5 || pad.buttons[14]?.pressed,
    right: ax > 0.5 || pad.buttons[15]?.pressed,
    up: ay < -0.5 || pad.buttons[12]?.pressed,
    down: ay > 0.5 || pad.buttons[13]?.pressed,
    undo: pad.buttons[1]?.pressed,
    reset: pad.buttons[3]?.pressed,
    start: pad.buttons[9]?.pressed || pad.buttons[0]?.pressed,
    pause: pad.buttons[8]?.pressed
  };
}

function wasPressed(action) {
  return Boolean(input.actions[action]) && !input.prev[action];
}
