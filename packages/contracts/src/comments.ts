// Comment threads for scene editor. Pinned to a scene node ("the tree") or a
// free world-coord point ("here"). Used for personal notes + as the natural
// hand-off point when asking the agent about a specific spot.

import type { Vec2 } from './scene.js';

export type CommentAnchor =
  | {
      kind: 'node';
      /** "Parent/Name" path within the scene — same shape as SceneCollider.ref.nodePath. */
      nodePath: string;
      /** Last-known world position; used as fallback when the node is missing. */
      fallback?: Vec2;
    }
  | { kind: 'point'; x: number; y: number };

export type CommentAuthor = 'user' | 'codex';

export interface CommentMessage {
  id: string;
  author: CommentAuthor;
  text: string;
  ts: number;
}

export interface CommentThread {
  id: string;
  /** Project-relative scene path this thread is anchored to. */
  scene: string;
  anchor: CommentAnchor;
  messages: CommentMessage[];
  status: 'open' | 'resolved';
  createdAt: number;
  updatedAt: number;
}

// ---------- Wire types ----------

export interface ListCommentsResponse {
  threads: CommentThread[];
}

export interface CreateCommentThreadRequest {
  projectPath: string;
  scene: string;
  anchor: CommentAnchor;
  text: string;
  author?: CommentAuthor;
}

export interface CreateCommentThreadResponse {
  thread: CommentThread;
}

export interface AppendCommentMessageRequest {
  projectPath: string;
  text: string;
  author?: CommentAuthor;
}

export interface AppendCommentMessageResponse {
  thread: CommentThread;
}

export interface UpdateCommentThreadRequest {
  projectPath: string;
  status?: 'open' | 'resolved';
  anchor?: CommentAnchor;
}

export interface UpdateCommentThreadResponse {
  thread: CommentThread;
}
