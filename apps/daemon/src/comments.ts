// Comment thread storage at <project>/.ogf/comments.json. Single file for V1
// (simple, easy to fetch all threads at once). Writes are atomic via temp+rename
// so concurrent reads never see a partial file.

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import type {
  CommentAnchor,
  CommentAuthor,
  CommentMessage,
  CommentThread,
} from '@ogf/contracts';

interface CommentsFile {
  version: 1;
  threads: CommentThread[];
}

function commentsFilePath(projectAbs: string): string {
  return path.join(projectAbs, '.ogf', 'comments.json');
}

function readFile(projectAbs: string): CommentsFile {
  const file = commentsFilePath(projectAbs);
  if (!existsSync(file)) return { version: 1, threads: [] };
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf8'));
    if (parsed && typeof parsed === 'object' && Array.isArray(parsed.threads)) {
      return { version: 1, threads: parsed.threads };
    }
  } catch {
    // corrupted file — start fresh; user can git restore if they care
  }
  return { version: 1, threads: [] };
}

function writeFile(projectAbs: string, data: CommentsFile): void {
  const dir = path.join(projectAbs, '.ogf');
  mkdirSync(dir, { recursive: true });
  const file = commentsFilePath(projectAbs);
  const tmp = path.join(dir, '.comments.tmp');
  writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8');
  renameSync(tmp, file);
}

export function listThreads(projectAbs: string, scene?: string): CommentThread[] {
  const data = readFile(projectAbs);
  const all = data.threads;
  if (scene) return all.filter((t) => t.scene === scene);
  return all;
}

export function createThread(opts: {
  projectAbs: string;
  scene: string;
  anchor: CommentAnchor;
  text: string;
  author?: CommentAuthor;
}): CommentThread {
  const data = readFile(opts.projectAbs);
  const now = Date.now();
  const message: CommentMessage = {
    id: randomUUID(),
    author: opts.author ?? 'user',
    text: opts.text,
    ts: now,
  };
  const thread: CommentThread = {
    id: randomUUID(),
    scene: opts.scene,
    anchor: opts.anchor,
    messages: [message],
    status: 'open',
    createdAt: now,
    updatedAt: now,
  };
  data.threads.push(thread);
  writeFile(opts.projectAbs, data);
  return thread;
}

export function appendMessage(opts: {
  projectAbs: string;
  threadId: string;
  text: string;
  author?: CommentAuthor;
}): CommentThread {
  const data = readFile(opts.projectAbs);
  const idx = data.threads.findIndex((t) => t.id === opts.threadId);
  if (idx < 0) throw new Error(`thread not found: ${opts.threadId}`);
  const thread = data.threads[idx];
  const now = Date.now();
  thread.messages.push({
    id: randomUUID(),
    author: opts.author ?? 'user',
    text: opts.text,
    ts: now,
  });
  thread.updatedAt = now;
  // Reopen if it was previously resolved.
  if (thread.status === 'resolved') thread.status = 'open';
  writeFile(opts.projectAbs, data);
  return thread;
}

export function updateThread(opts: {
  projectAbs: string;
  threadId: string;
  status?: 'open' | 'resolved';
  anchor?: CommentAnchor;
}): CommentThread {
  const data = readFile(opts.projectAbs);
  const idx = data.threads.findIndex((t) => t.id === opts.threadId);
  if (idx < 0) throw new Error(`thread not found: ${opts.threadId}`);
  const thread = data.threads[idx];
  if (opts.status) thread.status = opts.status;
  if (opts.anchor) thread.anchor = opts.anchor;
  thread.updatedAt = Date.now();
  writeFile(opts.projectAbs, data);
  return thread;
}

export function deleteThread(opts: { projectAbs: string; threadId: string }): void {
  const data = readFile(opts.projectAbs);
  const idx = data.threads.findIndex((t) => t.id === opts.threadId);
  if (idx < 0) return;
  data.threads.splice(idx, 1);
  writeFile(opts.projectAbs, data);
}
