/**
 * OPTIONAL secondary publish path — Cloudflare Pages "export" (SAAS_ARCHITECTURE
 * §7/§8: publish kept, triggered server-side). Ported in spirit from the old
 * local daemon flow (apps/daemon/src/server.ts `POST /api/publish`, which staged
 * static files and ran `npx wrangler@4 pages deploy`).
 *
 * The PRIMARY share path is `/play/<slug>` served from our own storage (see
 * core.ts) and needs ZERO Cloudflare. This module is a NO-OP unless BOTH
 * CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID are present, so:
 *   • local-dev / CI / `next build` never touch Cloudflare or wrangler,
 *   • the integration test exercises the gate (off) without any network.
 *
 * IMPLEMENTATION STATUS: gated + stubbed. When creds are present this currently
 * returns `{ exported:false, reason:'not_implemented' }` rather than spawning
 * wrangler — wiring the actual deploy (stage files from getStorage() → a temp
 * dir → `wrangler pages deploy`) is a follow-up. It NEVER runs during build or
 * tests. See the TODO below.
 */

/** True only when both Cloudflare creds are configured. */
export function cloudflareConfigured(): boolean {
  return Boolean(process.env.CLOUDFLARE_API_TOKEN && process.env.CLOUDFLARE_ACCOUNT_ID);
}

export type CfExportResult = {
  /** Whether a Cloudflare Pages deploy actually happened. */
  exported: boolean;
  /** The public Pages URL when exported, else null. */
  url: string | null;
  /** Why it didn't export (when exported=false). */
  reason?: "cloudflare_not_configured" | "not_implemented";
};

/**
 * Export a published game's static files to Cloudflare Pages. Local fallback:
 * a no-op that just signals the caller to use the `/play/<slug>` URL.
 *
 * @param _slug      the project's slug (also the Pages project name source)
 * @param _projectId storage prefix to read files from (via getStorage())
 */
export async function exportToCloudflarePages(
  slug: string,
  projectId: string,
): Promise<CfExportResult> {
  if (!cloudflareConfigured()) {
    // Local-dev / unconfigured: the share URL is /play/<slug>; nothing to do.
    return { exported: false, url: null, reason: "cloudflare_not_configured" };
  }

  // Creds are present but the wrangler deploy isn't wired yet (see TODO). Touch
  // the inputs so the stub's contract (slug + storage prefix) stays explicit.
  void slug;
  void projectId;

  // TODO(P5): port the daemon's deploy. Sketch (NEVER call wrangler at build/test):
  //   1. const files = await getStorage().getProjectFiles(projectId)
  //   2. stage them into a mkdtemp() dir (index.html + game.js + assets/* + data/*)
  //   3. spawn `npx --yes wrangler@4 pages deploy <dir> --project-name ogf-<slug>`
  //      with env CLOUDFLARE_API_TOKEN/CLOUDFLARE_ACCOUNT_ID + CI=1,
  //      WRANGLER_SEND_METRICS=false (see apps/daemon/src/server.ts)
  //   4. parse the printed https://<slug>.pages.dev URL from stdout
  //   5. persist it (projects.published_url could hold the CF URL instead)
  // Must remain dynamically isolated so no wrangler/network import happens unless
  // this branch is hit at runtime with real creds.
  return { exported: false, url: null, reason: "not_implemented" };
}
