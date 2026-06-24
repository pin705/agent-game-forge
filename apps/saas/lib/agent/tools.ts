import type { Sandbox } from "@/lib/sandbox";
import { textFile } from "@/lib/sandbox";
import type { RunEvent } from "./events";

/** OpenAI-compatible function-calling tool schemas (DeepSeek understands these). */
export const TOOL_SCHEMAS = [
  {
    type: "function" as const,
    function: {
      name: "read_file",
      description: "Read a UTF-8 text file from the project. Returns its content.",
      parameters: {
        type: "object",
        properties: { path: { type: "string", description: "Project-relative path" } },
        required: ["path"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "write_file",
      description: "Create or overwrite a text file with the given content.",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string" },
          content: { type: "string" },
        },
        required: ["path", "content"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "edit_file",
      description: "Replace the first occurrence of `old` with `new` in a file. `old` must match exactly.",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string" },
          old: { type: "string" },
          new: { type: "string" },
        },
        required: ["path", "old", "new"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "list_files",
      description: "List project files, optionally filtered by a POSIX glob (e.g. 'data/**/*.json').",
      parameters: {
        type: "object",
        properties: { glob: { type: "string" } },
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "run_shell",
      description:
        "Run a shell command in the sandbox (Python agent-tools, node --check, verify steps). Returns stdout/stderr/exit code.",
      parameters: {
        type: "object",
        properties: { cmd: { type: "string" } },
        required: ["cmd"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "emit_question_form",
      description:
        "Surface a structured clarifying question to the user. Use only when disambiguation is required before significant work.",
      parameters: {
        type: "object",
        properties: {
          id: { type: "string" },
          title: { type: "string" },
          fields: { type: "array", items: { type: "object" } },
        },
        required: ["id", "title"],
      },
    },
  },
];

export type ToolResult = { content: string; events: RunEvent[] };

/**
 * Execute one tool call against the sandbox. Returns the string fed back to
 * the model plus any UI events to stream. Never throws — errors become tool
 * results so the model can recover.
 */
export async function executeTool(
  sandbox: Sandbox,
  name: string,
  args: Record<string, unknown>,
): Promise<ToolResult> {
  const events: RunEvent[] = [];
  try {
    switch (name) {
      case "read_file": {
        // Model-facing: decode as UTF-8 text (models read/write html/js/json).
        const content = await sandbox.readFileText(String(args.path));
        if (content === null) return { content: `ERROR: file not found: ${args.path}`, events };
        return { content, events };
      }
      case "write_file": {
        const path = String(args.path);
        const content = String(args.content ?? "");
        // The model authors text; encode to bytes at the boundary.
        await sandbox.writeFiles([textFile(path, content)]);
        events.push({ type: "file_write", path, bytes: Buffer.byteLength(content) });
        return { content: `wrote ${path} (${Buffer.byteLength(content)} bytes)`, events };
      }
      case "edit_file": {
        const path = String(args.path);
        const existing = await sandbox.readFileText(path);
        if (existing === null) return { content: `ERROR: file not found: ${path}`, events };
        const oldStr = String(args.old);
        if (!existing.includes(oldStr))
          return { content: `ERROR: \`old\` not found in ${path}; no change made.`, events };
        const next = existing.replace(oldStr, String(args.new));
        await sandbox.writeFiles([textFile(path, next)]);
        events.push({ type: "file_write", path, bytes: Buffer.byteLength(next) });
        return { content: `edited ${path}`, events };
      }
      case "list_files": {
        const glob = args.glob ? String(args.glob) : "**/*";
        const files = await sandbox.readFiles([glob]);
        return { content: files.map((f) => f.path).join("\n") || "(no files)", events };
      }
      case "run_shell": {
        const cmd = String(args.cmd);
        const res = await sandbox.exec(cmd, { timeout: 120_000 });
        events.push({
          type: "shell",
          cmd,
          code: res.code,
          stdoutPreview: res.stdout.slice(0, 400),
        });
        return {
          content: `exit=${res.code}\n--- stdout ---\n${res.stdout}\n--- stderr ---\n${res.stderr}`,
          events,
        };
      }
      case "emit_question_form": {
        events.push({ type: "question", id: String(args.id), payload: args });
        return { content: `Question form '${args.id}' surfaced to the user. (P1: recorded as event.)`, events };
      }
      default:
        return { content: `ERROR: unknown tool '${name}'`, events };
    }
  } catch (err) {
    return { content: `ERROR executing ${name}: ${err instanceof Error ? err.message : String(err)}`, events };
  }
}
