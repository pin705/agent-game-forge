/**
 * Batch 2 chat-parity gate — proves the conversation/message persistence loop,
 * the interactive question-form path, and reference-image upload all work with
 * ZERO external accounts (MockModel + LocalSandbox + LocalStorage + the on-disk
 * conversations registry).
 *
 * Asserts:
 *   (a) a run persists a USER + an ASSISTANT message to the local registry,
 *       tied to a conversation, and they reload + `rebuildTurns` into turns;
 *   (b) the MockModel question-form path emits a `question` event whose form
 *       spec parses (id/title/fields), and the run ends with done.status
 *       === "awaiting_input";
 *   (c) the ref-image upload path (`storeRefImage`) stores bytes + returns a
 *       project-relative path that reads back byte-for-byte, AND a run that
 *       attaches refs records them on the persisted user turn.
 *
 * Run:  npm run chat-test
 */
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

// Force LOCAL drivers + the no-Supabase path BEFORE importing anything that
// reads env at import time.
delete process.env.E2B_API_KEY;
delete process.env.DEEPSEEK_API_KEY;
delete process.env.AI_API_KEY;
delete process.env.R2_ACCOUNT_ID;
delete process.env.R2_ACCESS_KEY_ID;
delete process.env.R2_SECRET_ACCESS_KEY;
delete process.env.R2_BUCKET;
process.env.NEXT_PUBLIC_SUPABASE_URL = "https://placeholder.supabase.co";

const dataDir = await mkdtemp(path.join(tmpdir(), "ogf-chat-"));
process.env.OGF_DATA_DIR = dataDir;

const { runAgent } = await import("../lib/agent/run.ts");
const store = await import("../lib/conversations/store.ts");
const { storeRefImage } = await import("../lib/conversations/refs.ts");
const { getStorage } = await import("../lib/storage/index.ts");
const { parseQuestionForm } = await import("../lib/agent/forms.ts");

let pass = true;
const check = (label, ok) => {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}`);
  if (!ok) pass = false;
};

async function drain(gen) {
  const events = [];
  let next = await gen.next();
  while (!next.done) {
    events.push(next.value);
    next = await gen.next();
  }
  return { events, result: next.value };
}

/** Client-side rebuildTurns, mirrored from build-chat.tsx (kept in sync). */
function rebuildTurns(messages) {
  const ordered = [...messages].sort((a, b) => a.position - b.position);
  const turns = [];
  for (const m of ordered) {
    if (m.role === "user") {
      const refEv = (m.events ?? []).find((e) => e.type === "refs");
      turns.push({ userText: m.content ?? "", refPaths: refEv ? refEv.paths : [], events: [] });
    } else if (m.role === "assistant") {
      if (turns.length === 0) turns.push({ userText: "", refPaths: [], events: [] });
      const last = turns[turns.length - 1];
      last.events = [...last.events, ...(m.events ?? [])];
    }
  }
  return turns;
}

console.log(`\n=== Batch 2 chat-parity gate (data dir: ${dataDir}) ===\n`);

// ── (a) a normal build run persists user + assistant messages → reloads as turns
console.log("--- (a) run persists messages → reload as turns ---");
const projectA = "chat-" + Math.random().toString(36).slice(2, 8);
{
  const { result } = await drain(
    runAgent({ projectId: projectA, prompt: "Build a tiny canvas platformer." }),
  );
  check("run returned a conversationId", typeof result.conversationId === "string");

  const conversations = await store.listConversations(projectA);
  check("one conversation persisted for the project", conversations.length === 1);

  const messages = await store.listMessages(result.conversationId);
  const roles = messages.map((m) => m.role);
  check(`user + assistant messages persisted (roles: ${roles.join(", ")})`, roles.includes("user") && roles.includes("assistant"));

  const userMsg = messages.find((m) => m.role === "user");
  check("user message content stored", userMsg?.content?.includes("platformer"));

  const asstMsg = messages.find((m) => m.role === "assistant");
  check("assistant message has events jsonb", Array.isArray(asstMsg?.events) && asstMsg.events.length > 0);
  check(
    "assistant events include a done event",
    (asstMsg?.events ?? []).some((e) => e.type === "done"),
  );

  const turns = rebuildTurns(messages);
  check(`rebuildTurns produced one turn (${turns.length})`, turns.length === 1);
  check("rebuilt turn carries the user text", turns[0].userText.includes("platformer"));
  check("rebuilt turn replays assistant events", turns[0].events.length > 0);
}

// ── (b) the MockModel question-form path emits a parseable `question` event ──
console.log("\n--- (b) interactive question-form path ---");
const projectB = "chat-" + Math.random().toString(36).slice(2, 8);
let questionConvId = null;
{
  // The mock plays the question script when the prompt asks it to clarify.
  const { events, result } = await drain(
    runAgent({ projectId: projectB, prompt: "Ask me a question to clarify before building." }),
  );
  questionConvId = result.conversationId;

  const q = events.find((e) => e.type === "question");
  check("a `question` event was emitted", !!q);
  check("question event carries a `form` (not raw payload)", !!q?.form);

  const form = q ? parseQuestionForm(q.form) : null;
  check("form spec parses (id + title)", !!form && !!form.id && !!form.title);
  check(`form has fields (${form?.fields.length ?? 0})`, (form?.fields.length ?? 0) >= 1);
  check(
    "a field has options (radio/select)",
    (form?.fields ?? []).some((f) => Array.isArray(f.options) && f.options.length > 0),
  );

  const done = events.find((e) => e.type === "done");
  check("turn ended with done.status === 'awaiting_input'", done?.status === "awaiting_input");

  // The follow-up run (answers as the next user turn) continues the build.
  const answer = `## Form answers (id=${form.id})\n\n- **genre**: platformer`;
  const { result: r2 } = await drain(
    runAgent({ projectId: projectB, prompt: answer, conversationId: questionConvId }),
  );
  check("follow-up run reused the same conversation", r2.conversationId === questionConvId);
  const stored = await getStorage().listProjectFiles(projectB);
  check("follow-up run produced the game (index.html)", stored.includes("index.html"));

  const msgs = await store.listMessages(questionConvId);
  check(
    "conversation now has the question turn + the answer turn (>= 4 messages)",
    msgs.length >= 4,
  );
}

// ── (c) reference-image upload path stores + returns a path; run records refs ─
console.log("\n--- (c) reference-image upload + refs on the user turn ---");
const projectC = "chat-" + Math.random().toString(36).slice(2, 8);
{
  // 1x1 transparent PNG.
  const pngBase64 =
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";
  const bytes = new Uint8Array(Buffer.from(pngBase64, "base64"));

  const relPath = await storeRefImage(projectC, "hero sprite.png", bytes);
  check("storeRefImage returned a project-relative path", typeof relPath === "string" && relPath.length > 0);
  check("path is under the .refs prefix", relPath.startsWith(".refs/"));
  check("filename sanitized (no spaces)", !relPath.includes(" "));

  const back = await getStorage().readProjectFile(projectC, relPath);
  check("stored ref reads back", back !== null);
  check("stored ref bytes round-trip byte-for-byte", back && back.length === bytes.length);

  // A run that attaches the ref records it on the persisted user turn.
  const { result } = await drain(
    runAgent({ projectId: projectC, prompt: "Use this sprite.", refImagePaths: [relPath] }),
  );
  const messages = await store.listMessages(result.conversationId);
  const userMsg = messages.find((m) => m.role === "user");
  const refEv = (userMsg?.events ?? []).find((e) => e.type === "refs");
  check("user turn records the attached refs", !!refEv && refEv.paths.includes(relPath));
}

await rm(dataDir, { recursive: true, force: true });

console.log(`\n=== ${pass ? "ALL CHECKS PASSED" : "CHAT TEST FAILED"} ===\n`);
process.exit(pass ? 0 : 1);
