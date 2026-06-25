// Data-driven config loader. Mirrors the side-scroll seed's cfg() contract so
// the verbatim particles.js (which reads cfg("hud").particles) works unchanged.
// All tuning lives in data/*.json — designers tune without touching code.
const configs = {};

async function loadJSON(path) {
  const res = await fetch(path);
  if (!res.ok) throw new Error("failed to load " + path + " (" + res.status + ")");
  return res.json();
}

async function loadConfigs() {
  const cfgData = await loadJSON("data/shmup-config.json");
  // Flatten the single config doc into named sections cfg() can address.
  for (const key of Object.keys(cfgData)) configs[key] = cfgData[key];
  configs.waves = await loadJSON("data/waves.json");
}

// cfg("player") / cfg("hud") / cfg("bullets") ... — never throws on a missing
// section so optional reads (cfg("hud").particles) degrade gracefully.
function cfg(name) {
  return configs[name] || {};
}
