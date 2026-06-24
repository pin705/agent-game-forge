import type { Sandbox } from "@/lib/sandbox";
import type { RunEvent } from "./events";
import { TOOL_SCHEMAS, executeTool } from "./tools";
import { type ChatMessage, type Model, getModel, modelDriverName } from "./model";
import { buildSystemPrompt } from "./system-prompt";

const MAX_STEPS = Number(process.env.AGENT_MAX_STEPS || 24);

export type LoopResult = {
  inputTokens: number;
  outputTokens: number;
  steps: number;
};

/**
 * The tool-use loop. System prompt + user prompt → model emits tool calls →
 * execute against the sandbox → feed results back → repeat until the model
 * stops (no tool calls) or MAX_STEPS. Yields every step as a RunEvent so the
 * API route can pipe them as SSE. Returns cumulative token totals (metering).
 */
export async function* runLoop(args: {
  sandbox: Sandbox;
  prompt: string;
  model?: Model;
}): AsyncGenerator<RunEvent, LoopResult, void> {
  const model = args.model ?? getModel(TOOL_SCHEMAS);

  const messages: ChatMessage[] = [
    { role: "system", content: buildSystemPrompt() },
    { role: "user", content: args.prompt },
  ];

  let inputTokens = 0;
  let outputTokens = 0;
  let steps = 0;

  for (let i = 0; i < MAX_STEPS; i++) {
    const res = await model.complete(messages);
    steps += 1;
    inputTokens += res.usage.inputTokens;
    outputTokens += res.usage.outputTokens;

    if (res.text) yield { type: "text_delta", text: res.text };
    yield {
      type: "step",
      index: i,
      inputTokens: res.usage.inputTokens,
      outputTokens: res.usage.outputTokens,
    };

    // Record the assistant turn (with tool calls) before executing tools.
    messages.push({
      role: "assistant",
      content: res.text || null,
      tool_calls: res.toolCalls.length ? res.toolCalls : undefined,
    });

    if (res.done) break;

    for (const call of res.toolCalls) {
      yield { type: "tool_call", id: call.id, name: call.name, args: call.arguments };
      const { content, events } = await executeTool(args.sandbox, call.name, call.arguments);
      for (const ev of events) yield ev;
      const ok = !content.startsWith("ERROR");
      yield {
        type: "tool_result",
        id: call.id,
        name: call.name,
        ok,
        summary: content.slice(0, 200),
      };
      messages.push({ role: "tool", tool_call_id: call.id, content });
    }
  }

  return { inputTokens, outputTokens, steps };
}

export { modelDriverName };
