/**
 * Model abstraction for the tool-use loop. Two implementations:
 *   - DeepSeekModel : OpenAI-compatible chat client (prod). Used when
 *                     DEEPSEEK_API_KEY is present.
 *   - MockModel     : deterministic scripted "model" (dev default). Drives the
 *                     loop through a realistic mini-build with zero accounts.
 *
 * Both speak the same minimal message protocol so the loop is driver-agnostic.
 */
import { isEnabledModel } from "./catalog";

export type ToolCall = {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
};

export type ChatMessage =
  | { role: "system" | "user"; content: string }
  | { role: "assistant"; content: string | null; tool_calls?: ToolCall[] }
  | { role: "tool"; tool_call_id: string; content: string };

export type ModelResponse = {
  /** Assistant text (may be empty when the turn is purely tool calls). */
  text: string;
  toolCalls: ToolCall[];
  /** Token usage for this single call — recorded on the run for metering. */
  usage: { inputTokens: number; outputTokens: number };
  /** True when the model produced no tool calls (loop should stop). */
  done: boolean;
};

export interface Model {
  readonly name: string;
  complete(messages: ChatMessage[]): Promise<ModelResponse>;
}

/** True when a real DeepSeek key is present. */
export function deepseekConfigured(): boolean {
  return Boolean(process.env.DEEPSEEK_API_KEY);
}

export function modelDriverName(): "deepseek" | "mock" {
  return deepseekConfigured() ? "deepseek" : "mock";
}

/** Default model id when a run doesn't request one (the configured DeepSeek
 *  model, else `deepseek-chat`). */
export function defaultModelId(): string {
  return process.env.DEEPSEEK_MODEL || "deepseek-chat";
}

/**
 * Resolve the model id a run will actually use from an OPTIONAL requested id.
 * Validates against the enabled catalog (never a faked/premium id); falls back
 * to the default when absent or not allowed. This is the id recorded on the run
 * and priced by the rate table (pricing.ts keys by these ids).
 */
export function resolveModelId(requestedId?: string | null): string {
  return isEnabledModel(requestedId) ? requestedId : defaultModelId();
}

/* -------------------------------------------------------------------------- */
/* DeepSeek (OpenAI-compatible)                                               */
/* -------------------------------------------------------------------------- */

export class DeepSeekModel implements Model {
  readonly name: string;
  // `openai` is imported dynamically (prod path only), so the client type is
  // not available statically here — typed via the dynamic import below.
  private clientPromise: Promise<import("openai").default> | null = null;
  private toolSchemas: unknown[];

  constructor(toolSchemas: unknown[], modelId?: string) {
    // The resolved model id (validated against the enabled catalog) is the id
    // we send to DeepSeek AND the id pricing charges by.
    this.name = resolveModelId(modelId);
    this.toolSchemas = toolSchemas;
  }

  private async client() {
    if (!this.clientPromise) {
      this.clientPromise = (async () => {
        const { default: OpenAI } = await import("openai");
        return new OpenAI({
          apiKey: process.env.DEEPSEEK_API_KEY,
          baseURL: process.env.DEEPSEEK_BASE_URL || "https://api.deepseek.com",
        });
      })();
    }
    return this.clientPromise;
  }

  async complete(messages: ChatMessage[]): Promise<ModelResponse> {
    const client = await this.client();
    // Map our messages to the OpenAI wire shape (tool_calls need arguments as JSON strings).
    const wire = messages.map((m) => {
      if (m.role === "assistant" && m.tool_calls?.length) {
        return {
          role: "assistant",
          content: m.content ?? "",
          tool_calls: m.tool_calls.map((tc) => ({
            id: tc.id,
            type: "function",
            function: { name: tc.name, arguments: JSON.stringify(tc.arguments) },
          })),
        };
      }
      return m;
    });

    const res = await client.chat.completions.create({
      model: this.name,
      // Our message + tool shapes are wire-compatible with the OpenAI SDK but
      // not structurally identical to its param types; cast at the boundary.
      messages: wire as Parameters<typeof client.chat.completions.create>[0]["messages"],
      tools: this.toolSchemas as Parameters<typeof client.chat.completions.create>[0]["tools"],
      tool_choice: "auto",
    });

    const choice = res.choices[0];
    const rawCalls = choice.message.tool_calls ?? [];
    const toolCalls: ToolCall[] = rawCalls.map((tc) => {
      // The union includes non-function tool calls; we only emit function tools.
      const fn = "function" in tc ? tc.function : { name: "", arguments: "" };
      let parsed: Record<string, unknown> = {};
      try {
        parsed = fn.arguments ? JSON.parse(fn.arguments) : {};
      } catch {
        parsed = {};
      }
      return { id: tc.id, name: fn.name, arguments: parsed };
    });

    return {
      text: choice.message.content ?? "",
      toolCalls,
      usage: {
        inputTokens: res.usage?.prompt_tokens ?? 0,
        outputTokens: res.usage?.completion_tokens ?? 0,
      },
      done: toolCalls.length === 0,
    };
  }
}

/* -------------------------------------------------------------------------- */
/* MockModel — deterministic scripted build (dev, zero accounts)              */
/* -------------------------------------------------------------------------- */

type Script = Array<{
  text: string;
  toolCalls: Array<{ name: string; arguments: Record<string, unknown> }>;
}>;

/**
 * A deterministic "model" that drives the loop through a realistic mini-build:
 * lists files, writes index.html + game.js + data/level.json, runs a shell
 * verify step, then finishes with no tool calls. Token usage is faked with a
 * stable per-step count so metering can be exercised end-to-end.
 */
export class MockModel implements Model {
  /** The selected model id (so the param → run → pricing path is exercised
   *  end-to-end even offline). Defaults to "mock-deepseek" when none is chosen. */
  readonly name: string;
  private step = 0;
  private readonly script: Script;

  constructor(modelId?: string) {
    // The mock ignores the id for BEHAVIOUR (deterministic script) but reports
    // the chosen id as its name so metering/pricing see the selected model.
    this.name = modelId && modelId.trim() ? modelId : "mock-deepseek";
    const indexHtml = `<!doctype html>
<html lang="en">
<head><meta charset="utf-8" /><meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Mock Game</title><style>html,body{margin:0;height:100%;background:#1b1b1f}canvas{display:block;margin:auto}</style></head>
<body><canvas id="game" width="320" height="180"></canvas><script src="game.js"></script></body>
</html>
`;
    const gameJs = `// Minimal Canvas game wired to data/level.json — produced by the P1 mock build.
const canvas = document.getElementById("game");
const ctx = canvas.getContext("2d");
let level = { player: { x: 16, y: 150 }, platforms: [] };
fetch("data/level.json").then((r) => r.json()).then((d) => { level = d; });
let t = 0;
function frame() {
  t += 1;
  ctx.fillStyle = "#1b1b1f";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = "#5a4632";
  for (const p of level.platforms) ctx.fillRect(p.x, p.y, p.w, p.h);
  const px = level.player.x + Math.sin(t / 20) * 6;
  ctx.fillStyle = "#e0794a";
  ctx.fillRect(px, level.player.y, 12, 16);
  requestAnimationFrame(frame);
}
frame();
`;
    const levelJson = JSON.stringify(
      {
        mapSize: { w: 320, h: 180 },
        player: { x: 16, y: 150 },
        platforms: [
          { x: 0, y: 168, w: 320, h: 12 },
          { x: 120, y: 130, w: 60, h: 8 },
        ],
      },
      null,
      2,
    );

    this.script = [
      {
        text: "Inspecting the project scaffold before building.",
        toolCalls: [{ name: "list_files", arguments: { glob: "**/*" } }],
      },
      {
        text: "Writing the HTML entry point.",
        toolCalls: [{ name: "write_file", arguments: { path: "index.html", content: indexHtml } }],
      },
      {
        text: "Writing the game logic (code separate from data).",
        toolCalls: [{ name: "write_file", arguments: { path: "game.js", content: gameJs } }],
      },
      {
        text: "Authoring the level data as JSON.",
        toolCalls: [
          { name: "write_file", arguments: { path: "data/level.json", content: levelJson } },
        ],
      },
      {
        text: "Running a verify step over the project files.",
        toolCalls: [
          {
            name: "run_shell",
            // Portable: python3 prints the file list, proving run_shell + a real
            // interpreter end-to-end. Falls back gracefully if python3 absent.
            arguments: {
              cmd: 'python3 -c "import os,glob; print(\'verify ok:\', sorted(glob.glob(\'**/*\', recursive=True)))" || echo "verify ok (no python3): $(ls -R)"',
            },
          },
        ],
      },
      {
        text: "Build complete: index.html + game.js + data/level.json are in place and verified. The game renders a player on platforms driven entirely by JSON data.",
        toolCalls: [],
      },
    ];
  }

  async complete(messages: ChatMessage[]): Promise<ModelResponse> {
    void messages; // deterministic: the mock ignores conversation state.
    const entry = this.script[Math.min(this.step, this.script.length - 1)];
    this.step += 1;
    const toolCalls: ToolCall[] = entry.toolCalls.map((tc, i) => ({
      id: `mock-call-${this.step}-${i}`,
      name: tc.name,
      arguments: tc.arguments,
    }));
    return {
      text: entry.text,
      toolCalls,
      // Deterministic, plausible token counts so P2 metering math has inputs.
      usage: { inputTokens: 800 + this.step * 50, outputTokens: 120 + this.step * 20 },
      done: toolCalls.length === 0,
    };
  }
}

/**
 * Factory: real DeepSeek when keyed, else the deterministic mock. The optional
 * `modelId` (a validated, enabled catalog id) selects the DeepSeek tier and is
 * reported as the model's `.name` so it flows into metering + pricing. When
 * absent/disallowed, `resolveModelId` falls back to the default.
 */
export function getModel(toolSchemas: unknown[], modelId?: string): Model {
  if (deepseekConfigured()) return new DeepSeekModel(toolSchemas, modelId);
  // Mock path: pass through a VALIDATED chosen id so metering sees the selected
  // model; with no (or a disallowed) selection it keeps its "mock-deepseek" name.
  return new MockModel(isEnabledModel(modelId) ? modelId : undefined);
}
