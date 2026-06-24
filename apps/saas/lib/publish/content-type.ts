/**
 * Pure helpers for the public play route — content-type resolution + safe path
 * normalisation. No I/O, no deps: imported by both the route handler and the
 * integration test so the exact same logic is exercised.
 */

/** Map a file extension → Content-Type for serving a game's static assets. */
const CONTENT_TYPES: Record<string, string> = {
  // markup / styles / scripts
  html: "text/html; charset=utf-8",
  htm: "text/html; charset=utf-8",
  css: "text/css; charset=utf-8",
  js: "text/javascript; charset=utf-8",
  mjs: "text/javascript; charset=utf-8",
  // data
  json: "application/json; charset=utf-8",
  txt: "text/plain; charset=utf-8",
  csv: "text/csv; charset=utf-8",
  xml: "application/xml; charset=utf-8",
  map: "application/json; charset=utf-8",
  wasm: "application/wasm",
  // images
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  svg: "image/svg+xml",
  webp: "image/webp",
  avif: "image/avif",
  ico: "image/x-icon",
  bmp: "image/bmp",
  // audio
  wav: "audio/wav",
  mp3: "audio/mpeg",
  ogg: "audio/ogg",
  oga: "audio/ogg",
  m4a: "audio/mp4",
  // fonts
  woff: "font/woff",
  woff2: "font/woff2",
  ttf: "font/ttf",
  otf: "font/otf",
  // video
  mp4: "video/mp4",
  webm: "video/webm",
};

/** Content-Type for a repo-relative path; defaults to octet-stream. */
export function contentTypeFor(path: string): string {
  const dot = path.lastIndexOf(".");
  const ext = dot >= 0 ? path.slice(dot + 1).toLowerCase() : "";
  return CONTENT_TYPES[ext] ?? "application/octet-stream";
}

/** Extensions whose bytes are binary (served base64-decoded from text storage). */
const BINARY_EXTS = new Set([
  "png", "jpg", "jpeg", "gif", "webp", "avif", "ico", "bmp",
  "wav", "mp3", "ogg", "oga", "m4a",
  "woff", "woff2", "ttf", "otf",
  "mp4", "webm", "wasm",
]);

/** True when a path's extension denotes binary content (not UTF-8 text). */
export function isBinaryPath(path: string): boolean {
  const dot = path.lastIndexOf(".");
  const ext = dot >= 0 ? path.slice(dot + 1).toLowerCase() : "";
  return BINARY_EXTS.has(ext);
}

/**
 * Normalise a requested play path to a SAFE, repo-relative POSIX path, or null
 * if it tries to escape the project (path traversal) or is otherwise illegal.
 *
 * Rules:
 *   - empty / undefined  → "index.html" (the game entry point)
 *   - strip leading "/"  → relative
 *   - reject backslashes, NUL, drive letters, protocol-ish "://"
 *   - resolve "." / ".." segments; ANY attempt to climb above the root → null
 *   - a trailing "/" (directory) → that dir's index.html
 *
 * The result never contains "..", never starts with "/", and is the key we hand
 * to the storage adapter (which scopes everything under projects/<id>/).
 */
export function sanitizePlayPath(input: string | string[] | undefined | null): string | null {
  let raw: string;
  if (input == null) raw = "";
  else if (Array.isArray(input)) raw = input.join("/");
  else raw = input;

  // Decode percent-encoding so "%2e%2e" can't smuggle a ".." past us. Bad
  // encodings are rejected.
  try {
    raw = decodeURIComponent(raw);
  } catch {
    return null;
  }

  // Hard rejects: backslashes (Windows separators), NUL bytes, Windows drive
  // letters, and anything that looks like an absolute URL/scheme.
  if (raw.includes("\\") || raw.includes("\0")) return null;
  if (/^[a-zA-Z]:/.test(raw)) return null;
  if (raw.includes("://")) return null;

  // Default + directory → index.html.
  if (raw === "" || raw === "/") return "index.html";
  const endsWithSlash = raw.endsWith("/");

  const segments: string[] = [];
  for (const part of raw.split("/")) {
    if (part === "" || part === ".") continue; // collapse // and ./
    if (part === "..") {
      // Climbing above the project root is forbidden (not just popped).
      if (segments.length === 0) return null;
      segments.pop();
      return null; // any ".." in a public play path is treated as hostile
    }
    segments.push(part);
  }

  if (segments.length === 0) return "index.html";
  const joined = segments.join("/");
  return endsWithSlash ? `${joined}/index.html` : joined;
}
