// How a WEB-engine game is served so a preview can run it:
//
// The OGF daemon mounts every registered *web* project's root as static
// files under `/api/web-play/:slug/`, where `slug = base64url(projectPath)`.
// See apps/daemon/src/server.ts → `app.use('/api/web-play/:slug', …)` which
// does `express.static(projectPath, { index: 'index.html' })`. The slug is
// shaped like a directory so the game's relative refs (src="src/game.js",
// fetch("data/x.json"), <img src="assets/…">) resolve correctly.
//
// The studio reaches it through the Vite `/api` proxy → :7621 (no backend
// changes). So a runnable game lives at:
//   /api/web-play/<slug>/index.html
//
// NOTE: the daemon's route 400s for non-web projects (it checks
// `row.engine !== 'web'`). This URL therefore only runs web-engine games.

/** base64url-encode a string exactly like Node's `Buffer.toString('base64url')`,
 *  so the slug round-trips through the daemon's `Buffer.from(slug, 'base64url')`
 *  decode. Unicode-safe. */
export function base64Url(s: string): string {
  const bytes = new TextEncoder().encode(s);
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** Static URL for any file inside a web project, via the daemon's web-play
 *  mount (through the `/api` proxy). `relPath` is project-relative. */
export function projectFileUrl(projectPath: string, relPath: string): string {
  return `/api/web-play/${base64Url(projectPath)}/${relPath.replace(/\\/g, '/')}`;
}

/** The runnable URL for a web game — its served index.html. Append a cache-
 *  busting param to force the iframe to reload fresh after edits. */
export function gameUrl(projectPath: string, cacheBust?: number): string {
  const base = projectFileUrl(projectPath, 'index.html');
  return cacheBust ? `${base}?_=${cacheBust}` : base;
}

/** Probe whether the game has a served index.html yet. The daemon's static
 *  mount returns 404 (fallthrough:false) when the file is absent, so a
 *  successful response means there's something to play. */
export async function hasPlayableIndex(projectPath: string): Promise<boolean> {
  try {
    const r = await fetch(projectFileUrl(projectPath, 'index.html'), {
      method: 'GET',
      cache: 'no-store',
    });
    return r.ok;
  } catch {
    return false;
  }
}
