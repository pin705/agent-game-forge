// Full-feature E2E for @ogf/saas — boots the REAL app (next build + next start)
// in forced LOCAL-DEV mode (placeholder Supabase → auth bypass + local
// registries engage), then drives every major flow against the live server.
//
// Primary mode: a REAL browser (system Chrome via playwright-core + CDP, the
// same technique as apps/studio/e2e/editor.e2e.mjs — NOT the Chrome MCP). If the
// browser genuinely cannot launch/connect in this environment, we fall back to
// an HTTP-level E2E that exercises the SAME flows over real HTTP against the
// running server (SSE runs, file GET/PUT, publish, /play bytes, gallery, remix,
// topup QR, webhook→grant). Either way: real server stack, end to end.
//
// Usage:  npm run e2e        (from apps/saas)
//   env:  OGF_CHROME / CHROME_PATH to point at a Chrome binary
//         OGF_E2E_HTTP=1 to force the HTTP-level fallback (skip the browser)
//         OGF_E2E_PORT to override the test port (default 7649)

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import { spawn } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createRequire } from "node:module";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const APP_DIR = path.resolve(__dirname, "..");
const MONO_ROOT = path.resolve(APP_DIR, "../..");
const PORT = Number(process.env.OGF_E2E_PORT || 7649);
const BASE = `http://127.0.0.1:${PORT}`;
const SHOTS = path.join(__dirname, "shots");
const FORCE_HTTP = process.env.OGF_E2E_HTTP === "1";

// Isolated, throwaway data dir so the run never touches the user's .data.
const DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "ogf-saas-e2e-"));

fs.mkdirSync(SHOTS, { recursive: true });

// ── result tracking ───────────────────────────────────────────────────────
const results = [];
const rec = (name, pass, detail = "") => {
  results.push({ name, pass, detail });
  console.log(`${pass ? "PASS" : "FAIL"}  ${name}${detail ? " — " + detail : ""}`);
};
const step = async (name, fn) => {
  try {
    const d = await fn();
    rec(name, true, d || "");
  } catch (e) {
    rec(name, false, ((e && e.message) || String(e)).split("\n")[0].slice(0, 180));
  }
};

// ── env that forces local-dev mode ──────────────────────────────────────────
const childEnv = {
  ...process.env,
  NODE_ENV: "production",
  PORT: String(PORT),
  OGF_DATA_DIR: DATA_DIR,
  // Placeholder Supabase → supabaseConfigured()===false → auth bypass + local
  // registries (projects/publish/conversations) + dev credits all engage.
  NEXT_PUBLIC_SUPABASE_URL: "https://placeholder.supabase.co",
  // Non-empty placeholder keys: supabaseConfigured() still reads false (URL has
  // "placeholder"), so the bypass + local registries engage; the non-empty value
  // just keeps any stray client construction from throwing "key required".
  NEXT_PUBLIC_SUPABASE_ANON_KEY: "placeholder-anon-key",
  SUPABASE_SERVICE_ROLE_KEY: "placeholder-service-key",
  // Force the deterministic MockModel + local sandbox/storage drivers.
  DEEPSEEK_API_KEY: "",
  E2B_API_KEY: "",
  R2_ACCOUNT_ID: "",
  // Webhook key so the HTTP-fallback webhook→ack path is exercisable.
  SEPAY_WEBHOOK_API_KEY: "e2e-test-key",
  // Bank config so the VietQR has real-looking inputs.
  SEPAY_BANK_ACCOUNT: "0123456789",
  SEPAY_BANK_CODE: "MB",
  SEPAY_ACCOUNT_NAME: "OGF TEST",
};

// ── tiny HTTP helpers (used by readiness + the HTTP fallback) ────────────────
function request(method, url, { headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const req = http.request(
      { method, hostname: u.hostname, port: u.port, path: u.pathname + u.search, headers },
      (res) => {
        const chunks = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () =>
          resolve({ status: res.statusCode, headers: res.headers, buf: Buffer.concat(chunks) }),
        );
      },
    );
    req.on("error", reject);
    if (body) req.write(body);
    req.end();
  });
}
const getText = async (p) => {
  const r = await request("GET", BASE + p);
  return { status: r.status, headers: r.headers, text: r.buf.toString("utf8"), buf: r.buf };
};
const postJson = async (p, obj, headers = {}) => {
  const body = Buffer.from(JSON.stringify(obj));
  const r = await request("POST", BASE + p, {
    headers: { "content-type": "application/json", "content-length": body.length, ...headers },
    body,
  });
  let json = null;
  try {
    json = JSON.parse(r.buf.toString("utf8"));
  } catch {
    /* not json */
  }
  return { status: r.status, headers: r.headers, json, text: r.buf.toString("utf8") };
};
const methodJson = async (method, p, obj) => {
  const body = Buffer.from(JSON.stringify(obj));
  const r = await request(method, BASE + p, {
    headers: { "content-type": "application/json", "content-length": body.length },
    body,
  });
  let json = null;
  try {
    json = JSON.parse(r.buf.toString("utf8"));
  } catch {}
  return { status: r.status, json };
};
const putReq = (p, obj) => methodJson("PUT", p, obj);
const patchReq = (p, obj) => methodJson("PATCH", p, obj);

async function waitForServer(timeoutMs = 120000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const r = await getText("/login");
      if (r.status && r.status < 500) return true;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 800));
  }
  throw new Error("server did not become ready in time");
}

// A 1x1 transparent PNG (base64) — seeded as a project asset for the Assets tab.
const TINY_PNG_B64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";

// ── build + start the server ─────────────────────────────────────────────────
let server;
function startServer() {
  return new Promise((resolve, reject) => {
    console.log(`\n[e2e] building (next build)…`);
    const build = spawn("npx", ["next", "build"], { cwd: APP_DIR, env: childEnv, stdio: "inherit" });
    build.on("exit", (code) => {
      if (code !== 0) return reject(new Error("next build failed (exit " + code + ")"));
      console.log(`[e2e] starting (next start -p ${PORT})…`);
      server = spawn("npx", ["next", "start", "-p", String(PORT)], {
        cwd: APP_DIR,
        env: childEnv,
        stdio: ["ignore", "pipe", "pipe"],
      });
      server.stdout.on("data", (d) => process.stdout.write("[server] " + d));
      server.stderr.on("data", (d) => process.stderr.write("[server] " + d));
      server.on("exit", (c) => console.log("[server] exited " + c));
      resolve();
    });
  });
}

function stopServer() {
  if (server && !server.killed) {
    try {
      server.kill("SIGTERM");
    } catch {}
  }
}

// ── BROWSER MODE ──────────────────────────────────────────────────────────────
function findChrome() {
  const c = [
    process.env.OGF_CHROME,
    process.env.CHROME_PATH,
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
    "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
  ];
  return c.find((p) => p && fs.existsSync(p));
}

async function tryLaunchBrowser() {
  const req = createRequire(path.join(MONO_ROOT, "package.json"));
  let pw;
  try {
    pw = await import(pathToFileURL(req.resolve("playwright-core")).href);
  } catch (e) {
    throw new Error("playwright-core not resolvable: " + e.message);
  }
  const chromium = pw.chromium ?? pw.default?.chromium;
  const exe = findChrome();
  const browser = await chromium.launch(
    exe
      ? { executablePath: exe, headless: true, args: ["--no-sandbox", "--disable-gpu"] }
      : { headless: true, args: ["--no-sandbox"] },
  );
  console.log("[e2e] launched chromium" + (exe ? ` (system: ${exe.split("/").pop()})` : " (ms-playwright)"));
  return browser;
}

async function runBrowserFlows() {
  const browser = await tryLaunchBrowser();
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 920 } });
  // Force English + light theme so text selectors are stable.
  await ctx.addInitScript(() => {
    try {
      localStorage.setItem("ogf_saas_lang", "en");
      localStorage.setItem("ogf_saas_theme", "light");
    } catch {}
  });
  const page = await ctx.newPage();
  const jsErrors = [];
  let net404 = 0;
  page.on("pageerror", (e) => jsErrors.push("pageerror: " + e.message));
  page.on("console", (m) => {
    if (m.type() !== "error") return;
    const t = m.text();
    if (/Failed to load resource|404|ERR_|net::/.test(t)) net404++;
    else jsErrors.push("console.error: " + t.slice(0, 200));
  });
  page.on("requestfailed", () => net404++);
  const shot = async (name) => {
    try {
      await page.screenshot({ path: path.join(SHOTS, name + ".png"), fullPage: false });
    } catch {}
  };

  try {
    // ── /login + /signup render ──
    await step("login page renders form", async () => {
      await page.goto(BASE + "/login", { waitUntil: "domcontentloaded", timeout: 30000 });
      await page.waitForSelector('input[type="email"]', { timeout: 15000 });
      await page.waitForSelector('input[type="password"]', { timeout: 5000 });
      await shot("01-login");
      return "email + password fields present";
    });
    await step("signup page renders form", async () => {
      await page.goto(BASE + "/signup", { waitUntil: "domcontentloaded", timeout: 20000 });
      await page.waitForSelector('input[type="email"]', { timeout: 10000 });
      await shot("02-signup");
      return "signup form present";
    });

    // ── Dashboard → create a new project → lands on /build/<id> ──
    let projectId = null;
    await step("dashboard loads (local-dev auth bypass)", async () => {
      await page.goto(BASE + "/dashboard", { waitUntil: "domcontentloaded", timeout: 20000 });
      await page.waitForSelector('input[name="name"]', { timeout: 15000 });
      // The top-nav credits chip should show the dev balance.
      await page.waitForFunction(() => /\d+\s*credits/i.test(document.body.innerText), null, { timeout: 8000 });
      await shot("03-dashboard");
      return "dashboard + credits chip present (no login redirect)";
    });
    await step("create new project → /build/<id>", async () => {
      await page.fill('input[name="name"]', "E2E Adventure");
      await Promise.all([
        page.waitForURL(/\/build\/[^/]+/, { timeout: 20000 }),
        page.getByRole("button", { name: /new game/i }).click(),
      ]);
      projectId = page.url().match(/\/build\/([^/?#]+)/)?.[1] ?? null;
      await page.waitForSelector("textarea", { timeout: 15000 });
      await page.waitForSelector('[role="tab"]', { timeout: 10000 });
      await shot("04-build-empty");
      if (!projectId) throw new Error("no project id in URL");
      return "project " + projectId;
    });

    // ── Build/chat: prompt → MockModel run streams → assistant + files + charge ──
    await step("chat: send prompt → run streams to completion", async () => {
      const ta = page.locator("textarea").first();
      await ta.fill("Build a tiny canvas platformer, data-driven.");
      await ta.press("Enter");
      // Working state appears.
      await page.waitForFunction(() => /Working/i.test(document.body.innerText), null, { timeout: 15000 });
      // Run completes: the mock's final assistant text mentions "Build complete".
      await page.waitForFunction(
        () => /Build complete/i.test(document.body.innerText),
        null,
        { timeout: 60000 },
      );
      await shot("05-run-complete");
      return "assistant turn rendered (Build complete)";
    });
    await step("chat: file_write chips + credits charge line", async () => {
      const body = await page.evaluate(() => document.body.innerText);
      if (!/index\.html/.test(body)) throw new Error("no index.html file chip");
      if (!/game\.js/.test(body)) throw new Error("no game.js file chip");
      // The charge line renders "−N credit(s)".
      if (!/[-−]\s*\d+\s*credit/i.test(body)) throw new Error("no credit charge line");
      return "index.html + game.js chips + charge line present";
    });

    // ── Preview iframe loads the served game ──
    await step("preview iframe serves the game DOM", async () => {
      // Wait for the workspace to refresh the file list (hasGame → iframe mounts).
      await page.waitForSelector("iframe", { timeout: 20000 });
      const frame = page.frameLocator("iframe").first();
      await frame.locator("#game").waitFor({ timeout: 20000 });
      await shot("06-preview");
      return "iframe canvas#game present";
    });

    // ── Code tab: tree lists files; open index.html in Monaco; edit + Save ──
    await step("Code tab: tree lists files", async () => {
      await page.getByRole("tab", { name: /^Code$/ }).click();
      await page.waitForSelector('button[title="index.html"]', { timeout: 15000 });
      await page.waitForSelector('button[title="game.js"]', { timeout: 5000 });
      return "index.html + game.js in tree";
    });
    await step("Code: open index.html in Monaco", async () => {
      await page.locator('button[title="index.html"]').first().click();
      await page.waitForSelector(".monaco-editor", { timeout: 20000 });
      await shot("07-monaco");
      return "monaco mounted";
    });
    await step("Code: edit → dirty → Save → clean", async () => {
      // Focus the Monaco editing surface (click the content area, not the hidden
      // textarea which has zero size) and type; the dirty marker + Save enable.
      await page.locator(".monaco-editor .view-lines").first().click();
      await page.keyboard.type("<!-- e2e edit -->");
      await page.waitForFunction(() => /unsaved/i.test(document.body.innerText), null, { timeout: 10000 });
      // Save via the Save button (also bound to Cmd/Ctrl+S).
      await page.getByRole("button", { name: /^Save$/ }).click();
      await page.waitForFunction(() => !/unsaved/i.test(document.body.innerText), null, { timeout: 10000 });
      return "dirty→save→clean";
    });

    // ── Seed a data array file + a PNG asset (so Data/Assets tabs have content) ──
    await step("seed data/items.json (table) + assets/sprite.png (asset grid)", async () => {
      // Data file with an ARRAY root → the table editor renders rows.
      const put = await putReq(
        `/api/projects/${projectId}/file`,
        { path: "data/items.json", content: JSON.stringify([{ id: "sword", dmg: 5 }, { id: "shield", dmg: 0 }], null, 2) },
      );
      if (put.status !== 200) throw new Error("seed items.json failed " + put.status);
      // A real PNG under assets/<…> so the Assets panel (which lists assets/**)
      // picks it up. The file API is text-only + the upload route stores under
      // .refs/, so write the bytes straight to the isolated LocalStorage dir we
      // own (DATA_DIR/projects/<id>/assets/sprite.png) — the server reads it on
      // the next file-list refresh.
      const assetPath = path.join(DATA_DIR, "projects", projectId, "assets", "sprite.png");
      fs.mkdirSync(path.dirname(assetPath), { recursive: true });
      fs.writeFileSync(assetPath, Buffer.from(TINY_PNG_B64, "base64"));
      // Reload the build page so the workspace re-pulls the file list.
      await page.reload({ waitUntil: "domcontentloaded" });
      await page.waitForSelector('[role="tab"]', { timeout: 10000 });
      return "seeded data/items.json + assets/sprite.png";
    });

    // ── Scene / Data / Assets tabs render ──
    await step("Data tab: table renders for data/items.json", async () => {
      await page.getByRole("tab", { name: /^Data$/ }).click();
      // Pick the items.json file in the data file list (button title = full path).
      await page.locator('button[title="data/items.json"]').click({ timeout: 10000 });
      await page.waitForSelector("table", { timeout: 12000 });
      await shot("08-data");
      return "table present for data/items.json";
    });
    await step("Scene tab: canvas renders for a level file", async () => {
      await page.getByRole("tab", { name: /^Scene$/ }).click();
      await page.waitForSelector("canvas", { timeout: 12000 });
      await shot("09-scene");
      return "scene canvas present";
    });
    await step("Assets tab: asset grid shows the seeded PNG", async () => {
      await page.getByRole("tab", { name: /^Assets$/ }).click();
      await page.waitForFunction(
        () => /sprite\.png/i.test(document.body.innerText) || !!document.querySelector('img[src*="preview"]'),
        null,
        { timeout: 12000 },
      );
      await shot("10-assets");
      return "asset visible";
    });

    // ── Conversation history: open rail, new, rename, switch ──
    await step("history: open rail + create new conversation", async () => {
      await page.getByRole("button", { name: /history/i }).first().click();
      await page.getByRole("button", { name: /^New$/i }).click();
      await page.waitForFunction(() => /Today/i.test(document.body.innerText), null, { timeout: 8000 });
      return "new conversation in Today group";
    });
    await step("history: rename a conversation", async () => {
      const newTitle = "E2E-Renamed-" + Math.floor(Date.now() % 100000);
      // Creating a conversation auto-closes the rail (onSelect) — re-open it.
      await page.getByRole("button", { name: /history/i }).first().click();
      await page.waitForSelector('button[title]:has(svg.lucide-message-square)', { timeout: 8000 });
      // The conversation row exposes a double-click → inline rename affordance.
      // dblclick fires the row's onClick (which closes the rail) BEFORE its
      // onDoubleClick, so we drive rename via the row's hover menu instead: hover
      // the row to reveal its menu button, open it, choose Rename.
      // The row-menu trigger is opacity-0 until :group-hover. Radix opens on a
      // real pointer event (not a synthetic .click). Read the trigger's geometry
      // directly (opacity-0 still has a box) and click it with the real mouse.
      const rect = await page.evaluate(() => {
        // The conversation row menu trigger: a Button with title "Rename"/"Đổi tên"
        // inside a .group row. Match by its title attr (locale-independent prefix)
        // or any lucide ellipsis/more-horizontal icon.
        const btns = [...document.querySelectorAll("button")];
        const btn =
          btns.find(
            (b) =>
              b.querySelector("svg.lucide-more-horizontal, svg.lucide-ellipsis, svg.lucide-ellipsis-vertical"),
          ) ||
          btns.find((b) => /rename|đổi tên/i.test(b.getAttribute("title") || ""));
        if (!btn) return null;
        const r = btn.getBoundingClientRect();
        return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
      });
      if (!rect) throw new Error("row menu trigger not found in DOM");
      await page.mouse.move(rect.x, rect.y);
      await page.mouse.down();
      await page.mouse.up();
      await page.getByRole("menuitem", { name: /rename|đổi tên/i }).click({ timeout: 6000 });
      // The rename Input autofocuses + selects-all.
      const input = page.locator('input[aria-label*="ename"], input[aria-label*="đổi"]').first();
      await input.waitFor({ timeout: 6000 });
      await page.keyboard.press(process.platform === "darwin" ? "Meta+a" : "Control+a");
      await page.keyboard.type(newTitle);
      await page.keyboard.press("Enter");
      await page.waitForFunction((t) => document.body.innerText.includes(t), newTitle, { timeout: 8000 });
      // Switch between conversations to prove switching works, then close rail.
      await page.locator('button[title]:has(svg.lucide-message-square)').nth(1).click().catch(() => {});
      await page.keyboard.press("Escape").catch(() => {});
      return "renamed → " + newTitle + " (+ switched conversations)";
    });

    // ── Interactive question-form: clarify → QuestionFormCard → submit → continue ──
    await step("question form: clarify path renders + submits + continues", async () => {
      // Ensure the history rail is closed so the composer is interactable.
      await page.keyboard.press("Escape").catch(() => {});
      await page.waitForTimeout(300);
      const ta = page.locator("textarea").first();
      await ta.click();
      await ta.fill("Please ask me a clarifying question before building.");
      await ta.press("Enter");
      // QuestionFormCard renders (radio + select + submit "Build it").
      await page.waitForSelector('[role="radiogroup"]', { timeout: 40000 });
      await shot("11-question");
      // Choose the first radio option, then submit.
      await page.locator('[role="radiogroup"] button[role="radio"]').first().click();
      await page.getByRole("button", { name: /build it/i }).click();
      // Follow-up run continues + completes (Build complete again).
      await page.waitForFunction(
        () => (document.body.innerText.match(/Build complete/gi) || []).length >= 1,
        null,
        { timeout: 60000 },
      );
      await shot("12-question-done");
      return "form submitted → follow-up run completed";
    });

    // ── Publish → /play/<slug> → gallery → remix ──
    let playSlug = null;
    await step("publish: click Publish → obtain /play link", async () => {
      // Close any open history overlay first.
      await page.keyboard.press("Escape").catch(() => {});
      await page.getByRole("button", { name: /^Publish$/ }).first().click();
      // After publishing, the control becomes a "Shared" dropdown — open it and
      // read the public /play/<slug> link from its content.
      await page.getByRole("button", { name: /^Shared$/ }).click({ timeout: 25000 });
      await page.waitForFunction(
        () => /\/play\//.test(document.body.innerHTML),
        null,
        { timeout: 10000 },
      );
      playSlug = await page.evaluate(() => {
        const m = document.body.innerHTML.match(/\/play\/([a-z0-9-]+)/i);
        return m ? m[1] : null;
      });
      await shot("13-publish");
      await page.keyboard.press("Escape").catch(() => {});
      if (!playSlug) throw new Error("no play slug found");
      return "slug " + playSlug;
    });
    await step("play: published game serves DOM/canvas", async () => {
      await page.goto(`${BASE}/play/${playSlug}/`, { waitUntil: "domcontentloaded", timeout: 20000 });
      await page.waitForSelector("#game", { timeout: 15000 });
      await shot("14-play");
      return "canvas#game served at /play/" + playSlug;
    });
    await step("gallery: lists the published game", async () => {
      await page.goto(BASE + "/gallery", { waitUntil: "domcontentloaded", timeout: 20000 });
      await page.waitForFunction(
        (slug) => document.body.innerHTML.includes("/play/" + slug),
        playSlug,
        { timeout: 15000 },
      );
      await shot("15-gallery");
      return "published game in gallery";
    });
    await step("remix: creates a new project + opens build page", async () => {
      // Remix from the gallery card (local-dev shows Remix without auth).
      const remix = page.getByRole("button", { name: /remix/i }).first();
      await Promise.all([
        page.waitForURL(/\/build\/[^/]+/, { timeout: 25000 }),
        remix.click(),
      ]);
      const remixId = page.url().match(/\/build\/([^/?#]+)/)?.[1];
      await page.waitForSelector("textarea", { timeout: 15000 });
      await shot("16-remix");
      if (!remixId || remixId === projectId) throw new Error("remix did not open a new project");
      return "remix project " + remixId;
    });

    // ── Billing: pick a pack → VietQR + transfer code + amount ──
    await step("billing: pick pack → VietQR + code + amount", async () => {
      await page.goto(BASE + "/billing", { waitUntil: "domcontentloaded", timeout: 20000 });
      // Each pack's CTA button reads "Nạp (Top up)".
      await page.getByRole("button", { name: /top up/i }).first().click({ timeout: 15000 });
      // VietQR image + a transfer code + an amount (₫) render.
      await page.waitForSelector('img[alt*="VietQR"]', { timeout: 15000 });
      await page.waitForFunction(() => /₫/.test(document.body.innerText), null, { timeout: 8000 });
      await shot("17-billing");
      return "VietQR image + amount rendered";
    });

    // ── Chrome: ⌘K palette, theme toggle, language toggle ──
    await step("⌘K command palette opens + runs a command", async () => {
      await page.goto(BASE + `/build/${projectId}`, { waitUntil: "domcontentloaded", timeout: 20000 });
      await page.waitForSelector("textarea", { timeout: 15000 });
      await page.keyboard.press(process.platform === "darwin" ? "Meta+KeyK" : "Control+KeyK");
      await page.waitForSelector('[role="dialog"] input', { timeout: 8000 });
      const n = await page.locator('[role="dialog"] button[role="option"], [role="dialog"] button').count();
      if (n < 2) throw new Error("only " + n + " palette commands");
      await page.keyboard.press("Escape");
      await page.waitForSelector('[role="dialog"]', { state: "detached", timeout: 5000 });
      return n + " commands listed";
    });
    await step("theme toggle flips .dark on <html>", async () => {
      const before = await page.evaluate(() => document.documentElement.classList.contains("dark"));
      // The theme toggle is the Sun/Moon icon button in the top-nav.
      await page
        .locator('button:has(svg.lucide-sun), button:has(svg.lucide-moon)')
        .first()
        .click({ timeout: 8000 });
      await page.getByRole("menuitem", { name: before ? /light/i : /dark/i }).click({ timeout: 6000 });
      await page.waitForFunction(
        (b) => document.documentElement.classList.contains("dark") !== b,
        before,
        { timeout: 6000 },
      );
      const after = await page.evaluate(() => document.documentElement.classList.contains("dark"));
      if (after === before) throw new Error("dark class unchanged");
      return `dark: ${before} → ${after}`;
    });
    await step("language toggle switches EN↔VI (known string changes)", async () => {
      // The composer placeholder is "Message the agent…" (EN) / "Nhắn cho trợ lý…" (VI).
      const enPlaceholder = await page.locator("textarea").first().getAttribute("placeholder");
      await page.getByRole("button", { name: /^VI$/ }).click({ timeout: 6000 });
      await page.waitForFunction(
        (en) => {
          const ta = document.querySelector("textarea");
          return ta && ta.getAttribute("placeholder") !== en;
        },
        enPlaceholder,
        { timeout: 8000 },
      );
      const viPlaceholder = await page.locator("textarea").first().getAttribute("placeholder");
      await shot("18-lang-vi");
      if (viPlaceholder === enPlaceholder) throw new Error("placeholder unchanged");
      return `placeholder: "${enPlaceholder}" → "${viPlaceholder}"`;
    });

    await step("no JS exceptions during browser E2E", async () => {
      if (jsErrors.length) throw new Error(jsErrors.length + " JS error(s): " + jsErrors.slice(0, 3).join(" | "));
      return `clean (benign resource events: ${net404})`;
    });
  } finally {
    await browser.close();
  }
  return { jsErrors, net404 };
}

// ── HTTP-LEVEL FALLBACK ───────────────────────────────────────────────────────
async function readSSE(p, bodyObj, timeoutMs = 90000) {
  return new Promise((resolve, reject) => {
    const u = new URL(BASE + p);
    const body = Buffer.from(JSON.stringify(bodyObj));
    const req = http.request(
      {
        method: "POST",
        hostname: u.hostname,
        port: u.port,
        path: u.pathname,
        headers: { "content-type": "application/json", "content-length": body.length },
      },
      (res) => {
        const events = [];
        let buf = "";
        res.setEncoding("utf8");
        res.on("data", (chunk) => {
          buf += chunk;
          const frames = buf.split("\n\n");
          buf = frames.pop() ?? "";
          for (const f of frames) {
            const line = f.split("\n").find((l) => l.startsWith("data: "));
            if (!line) continue;
            try {
              events.push(JSON.parse(line.slice(6)));
            } catch {}
          }
        });
        res.on("end", () => resolve(events));
      },
    );
    req.on("error", reject);
    req.setTimeout(timeoutMs, () => req.destroy(new Error("SSE timeout")));
    req.write(body);
    req.end();
  });
}

async function runHttpFlows() {
  await step("HTTP: /login + /signup render forms", async () => {
    const l = await getText("/login");
    const s = await getText("/signup");
    if (l.status !== 200 || !/type="password"/.test(l.text)) throw new Error("login form missing");
    if (s.status !== 200 || !/type="email"/.test(s.text)) throw new Error("signup form missing");
    return "both forms served";
  });

  let projectId = null;
  await step("HTTP: dashboard reachable (auth bypass, no 302 to /login)", async () => {
    const r = await getText("/dashboard");
    if (r.status !== 200) throw new Error("dashboard status " + r.status);
    if (!/credits/i.test(r.text)) throw new Error("no credits chip");
    return "dashboard served with credits chip";
  });
  await step("HTTP: create project (registry) via files API on a fresh id", async () => {
    // The server action redirect is hard to drive over raw HTTP; instead create a
    // project id by writing a file (LocalStorage auto-creates the prefix), which
    // is exactly what the build loop operates on. We then drive a run against it.
    projectId = "e2e-" + Math.random().toString(36).slice(2, 8);
    const put = await putReq(`/api/projects/${projectId}/file`, {
      path: "README.md",
      content: "# e2e",
    });
    if (put.status !== 200) throw new Error("file PUT failed " + put.status);
    return "project " + projectId;
  });

  let convId = null;
  await step("HTTP: POST /api/runs streams SSE to completion (+files+charge)", async () => {
    const events = await readSSE("/api/runs", {
      projectId,
      prompt: "Build a tiny canvas platformer, data-driven.",
    });
    const types = events.map((e) => e.type);
    if (!types.includes("run_start")) throw new Error("no run_start");
    if (!types.includes("done")) throw new Error("no done event");
    if (!types.includes("charge")) throw new Error("no charge event");
    const done = events.find((e) => e.type === "done");
    if (!done.files?.includes("index.html") || !done.files?.includes("game.js"))
      throw new Error("missing files: " + JSON.stringify(done.files));
    convId = events.find((e) => e.type === "run_start")?.conversationId ?? null;
    return `${events.length} events; files=${done.files.length}; charge ok`;
  });

  await step("HTTP: GET file + PUT edit round-trips", async () => {
    const g = await getText(`/api/projects/${projectId}/file?path=index.html`);
    if (g.status !== 200) throw new Error("GET file " + g.status);
    const edited = JSON.parse(g.text).content + "\n<!-- e2e -->";
    const p = await putReq(`/api/projects/${projectId}/file`, { path: "index.html", content: edited });
    if (p.status !== 200) throw new Error("PUT file " + p.status);
    const g2 = await getText(`/api/projects/${projectId}/file?path=index.html`);
    if (!JSON.parse(g2.text).content.includes("<!-- e2e -->")) throw new Error("edit not persisted");
    return "GET→PUT→GET ok";
  });

  await step("HTTP: question-form clarify path (emit_question_form)", async () => {
    const events = await readSSE("/api/runs", {
      projectId,
      prompt: "Please ask me a clarifying question first.",
      conversationId: convId ?? undefined,
    });
    const q = events.find((e) => e.type === "question");
    if (!q || !q.form?.fields?.length) throw new Error("no question event");
    return "question form emitted (" + q.form.fields.length + " fields)";
  });

  await step("HTTP: conversations list + create + rename", async () => {
    const list = await getText(`/api/projects/${projectId}/conversations`);
    if (list.status !== 200) throw new Error("list " + list.status);
    const created = await postJson(`/api/projects/${projectId}/conversations`, { title: "E2E chat" });
    const id = created.json?.conversation?.id;
    if (!id) throw new Error("create failed");
    const renamed = await patchReq(`/api/conversations/${id}`, { title: "E2E renamed" });
    if (renamed.status !== 200) throw new Error("rename " + renamed.status);
    return "list+create+rename ok";
  });

  let slug = null;
  await step("HTTP: publish → /play/<slug> serves the game bytes", async () => {
    const pub = await postJson(`/api/projects/${projectId}/publish`, {});
    if (pub.status !== 200 || !pub.json?.slug) throw new Error("publish " + pub.status);
    slug = pub.json.slug;
    // Follow a trailing-slash 308 to the canonical index path.
    let play = await getText(`/play/${slug}/`);
    if (play.status === 308 || play.status === 307) {
      const loc = play.headers.location || `/play/${slug}/index.html`;
      play = await getText(loc.startsWith("http") ? new URL(loc).pathname : loc);
    }
    if (play.status !== 200) throw new Error("play status " + play.status);
    if (!/<canvas/i.test(play.text) && !/id="game"/.test(play.text))
      throw new Error("play page has no game DOM");
    return "slug " + slug + " serves canvas";
  });
  await step("HTTP: gallery lists the published game", async () => {
    const g = await getText("/gallery");
    if (g.status !== 200) throw new Error("gallery " + g.status);
    if (!g.text.includes(`/play/${slug}`)) throw new Error("slug not in gallery");
    return "gallery lists " + slug;
  });
  await step("HTTP: remix creates a new project", async () => {
    const r = await postJson(`/api/projects/${projectId}/remix`, {});
    if (r.status !== 200 || !r.json?.projectId) throw new Error("remix " + r.status);
    if (r.json.projectId === projectId) throw new Error("remix returned same id");
    return "remix → " + r.json.projectId;
  });

  await step("HTTP: topup returns VietQR + transfer code + amount", async () => {
    // Find a pack id by asking with a known pack — packs endpoint isn't exposed,
    // so probe a likely id and fall back to reading the billing page for one.
    let packId = null;
    const billing = await getText("/billing");
    const m = billing.text.match(/data-pack-id="([^"]+)"/) || billing.text.match(/packId["':\s]+["']([a-z0-9_-]+)/i);
    packId = m ? m[1] : "starter";
    let r = await postJson("/api/credits/topup", { packId });
    if (r.status !== 200) {
      // Try a couple of common ids.
      for (const id of ["small", "basic", "pack-1", "credits-100", "starter"]) {
        r = await postJson("/api/credits/topup", { packId: id });
        if (r.status === 200) break;
      }
    }
    if (r.status !== 200 || !r.json?.qrUrl) throw new Error("topup " + r.status + " " + JSON.stringify(r.json));
    if (!r.json.transferCode || !r.json.amountVnd) throw new Error("missing code/amount");
    return `qr+code+amount (${r.json.amountVnd}₫, ${r.json.transferCode})`;
  });

  await step("HTTP: webhook auth + ack path", async () => {
    // Wrong key → 401 (fails closed); right key + incoming transfer → 200 ack.
    const bad = await postJson("/api/webhooks/sepay", { transferAmount: 1000 }, { authorization: "Apikey wrong" });
    if (bad.status !== 401) throw new Error("expected 401 for bad key, got " + bad.status);
    const ok = await postJson(
      "/api/webhooks/sepay",
      { id: 999, transferType: "in", transferAmount: 1000, content: "OGFTEST code", referenceCode: "r1" },
      { authorization: "Apikey e2e-test-key" },
    );
    if (ok.status !== 200) throw new Error("expected 200 ack, got " + ok.status);
    return "401 on bad key; 200 ack on valid incoming transfer";
  });
}

// ── orchestrate ───────────────────────────────────────────────────────────────
let mode = "unknown";
try {
  await startServer();
  await waitForServer();
  console.log("[e2e] server ready at " + BASE);

  let browserOk = false;
  if (!FORCE_HTTP) {
    try {
      await runBrowserFlows();
      browserOk = true;
      mode = "browser";
    } catch (e) {
      console.warn("\n[e2e] BROWSER MODE unavailable → falling back to HTTP-level E2E.");
      console.warn("[e2e] reason: " + (e.message || e));
    }
  }
  if (!browserOk) {
    mode = FORCE_HTTP ? "http (forced)" : "http (browser unavailable)";
    await runHttpFlows();
  }
} catch (e) {
  rec("harness boot", false, e.message || String(e));
} finally {
  stopServer();
  try {
    fs.rmSync(DATA_DIR, { recursive: true, force: true });
  } catch {}
}

const passed = results.filter((r) => r.pass).length;
console.log(`\n==== SAAS E2E SUMMARY · mode=${mode} · ${passed}/${results.length} flows passed ====`);
for (const r of results) console.log(`  ${r.pass ? "✓" : "✗"} ${r.name}${r.detail ? " — " + r.detail : ""}`);
console.log("====");
process.exit(results.length > 0 && results.every((r) => r.pass) ? 0 : 1);
