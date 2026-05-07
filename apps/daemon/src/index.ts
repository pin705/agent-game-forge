import path from 'node:path';
import { createServer } from './server.js';
import { openDb } from './db.js';

const PORT = Number(process.env.OGF_DAEMON_PORT ?? 7621);
const HOST = process.env.OGF_DAEMON_HOST ?? '127.0.0.1';

const dbPath =
  process.env.OGF_DB_PATH ??
  path.resolve(process.cwd(), '.ogf', 'app.sqlite');

openDb({ filePath: dbPath });
console.log(`[ogf-daemon] db: ${dbPath}`);

// Last-resort crash shields. We've fixed the known SSE socket-write
// path that crashed the daemon (runs.ts / godot.ts now use writeSseSafe),
// but a single unhandled 'error' from any other long-lived socket /
// child_process / FS watcher would still take the whole daemon down.
// Logging + survive is much better than dying mid-session — the user
// loses chat history and any active codex run when the process exits.
process.on('uncaughtException', (err) => {
  console.error('[ogf-daemon] uncaughtException:', err instanceof Error ? err.stack : err);
});
process.on('unhandledRejection', (reason) => {
  console.error('[ogf-daemon] unhandledRejection:', reason);
});

const app = createServer();
app.listen(PORT, HOST, () => {
  console.log(`[ogf-daemon] listening on http://${HOST}:${PORT}`);
});
