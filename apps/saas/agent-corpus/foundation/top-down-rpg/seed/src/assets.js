function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`Could not load ${src}`));
    img.src = src;
  });
}

// Forgiving image loader — returns null + warns on missing file instead of
// rejecting. Used for asset manifest + prop sprites where missing assets
// during early development should not crash the boot sequence.
async function loadImageSafe(src) {
  try {
    return await loadImage(src);
  } catch (err) {
    console.warn(`[assets] missing image: ${src} — using fallback`);
    return null;
  }
}

// Asset-free fallback so the game RENDERS before art exists (and never crashes
// drawImage on a missing sprite). Returns a canvas (a valid drawImage source)
// with a key-derived color + label; sliceable as a 2x2 sheet. Real art replaces it.
function makeFallbackImage(key) {
  const c = document.createElement("canvas");
  c.width = 256;
  c.height = 256;
  const g = c.getContext("2d");
  let h = 0;
  for (let i = 0; i < key.length; i += 1) h = (h * 31 + key.charCodeAt(i)) >>> 0;
  g.fillStyle = `hsl(${h % 360}, 42%, 40%)`;
  g.fillRect(0, 0, 256, 256);
  g.strokeStyle = "rgba(255,255,255,0.3)";
  g.lineWidth = 4;
  g.strokeRect(4, 4, 248, 248);
  g.fillStyle = "rgba(255,255,255,0.85)";
  g.font = "bold 20px monospace";
  g.textAlign = "center";
  g.fillText(String(key).slice(0, 14), 128, 134);
  return c;
}

async function loadJSON(src) {
  const response = await fetch(src);
  if (!response.ok) throw new Error(`Could not load ${src}`);
  return response.json();
}

async function loadGameData() {
  const [
    runtimeConfig,
    assetManifest,
    starters,
    enemies,
    items,
    musicThemes,
    audioConfig,
    ui,
    progression,
    overworld,
    battle,
    battleStrings,
  ] = await Promise.all([
    loadJSON("data/runtime.json"),
    loadJSON("data/assets.json"),
    loadJSON("data/starters.json"),
    loadJSON("data/enemies.json"),
    loadJSON("data/items.json"),
    loadJSON("data/music-themes.json"),
    loadJSON("data/audio-config.json"),
    loadJSON("data/ui.json"),
    loadJSON("data/progression-config.json"),
    loadJSON("data/overworld-config.json"),
    loadJSON("data/battle-config.json"),
    loadJSON("data/battle-strings.json"),
  ]);

  applyRuntimeConfig(runtimeConfig);
  applyAssetManifest(assetManifest);
  applyCatalogData({ starters, enemies, items });
  applyMusicThemes(musicThemes);
  applyAudioConfig(audioConfig);
  applyUiData(ui);
  applyTuningData({ progression, overworld, battle });
  applyBattleStrings(battleStrings);
  state.inventory = normalizeInventory(state.inventory);
}

async function loadAssets() {
  await loadGameData();
  const levelEntries = await loadJSON("data/levels.json");
  const levels = Array.isArray(levelEntries) ? levelEntries : levelEntries.levels;
  applyLevelMetadata(levels);
  const loadedLevels = await Promise.all(levels.map(async (level) => [level.id, await loadJSON(level.file)]));

  await Promise.all([
    ...Object.entries(imagePaths).map(async ([key, src]) => {
      const img = await loadImageSafe(src);
      images[key] = img || makeFallbackImage(key);
    }),
  ]);

  for (const [id, data] of loadedLevels) {
    collisionMaps[id] = data;
    validateCollisionMap(data);
  }
  collisionMap = collisionMaps.outdoor ?? loadedLevels[0]?.[1] ?? null;

  // Lazy-load all prop sprites referenced by JSON. Stored under the path
  // string itself so drawMapProp can look them up via prop.image.
  const propSrcs = new Set();
  for (const [, map] of loadedLevels) {
    for (const p of map.props ?? []) {
      if (p.image) propSrcs.add(p.image);
    }
  }
  await Promise.all(
    [...propSrcs].map(async (src) => {
      if (images[src]) return;
      const img = await loadImageSafe(src);
      images[src] = img || makeFallbackImage(src);
    }),
  );
}
