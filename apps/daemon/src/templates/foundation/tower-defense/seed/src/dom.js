// dom.js — canvas + ctx access. Mirrors side-scroll seed.
const dom = {
  canvas: null,
  ctx: null
};

function initDom() {
  dom.canvas = document.getElementById("game");
  dom.ctx = dom.canvas.getContext("2d");
}
