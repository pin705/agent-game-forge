/**
 * Run events — streamed out of the agent loop (async generator) and piped to
 * the client as SSE by the API route. One discriminated union for everything
 * the UI needs to render a live build.
 */
export type RunEvent =
  | { type: "run_start"; runId: string; sandboxId: string; model: string; conversationId: string | null; driver: { sandbox: string; storage: string; model: string } }
  | { type: "text_delta"; text: string }
  | { type: "tool_call"; id: string; name: string; args: Record<string, unknown> }
  | { type: "tool_result"; id: string; name: string; ok: boolean; summary: string }
  | { type: "file_write"; path: string; bytes: number }
  | { type: "shell"; cmd: string; code: number; stdoutPreview: string }
  // Interactive clarification: the agent surfaced a structured question form.
  // `form` is the spec the QuestionFormCard renders; the turn ends cleanly with
  // a `done` event whose `status` is `awaiting_input` (the SSE stream is NEVER
  // held open waiting for the answer — the client POSTs a follow-up run with the
  // answers as the next user turn). See lib/agent/forms.ts + tools.ts.
  | { type: "question"; id: string; form: QuestionForm }
  | { type: "step"; index: number; inputTokens: number; outputTokens: number }
  | {
      type: "done";
      inputTokens: number;
      outputTokens: number;
      steps: number;
      files: string[];
      /** `complete` for a normal finish; `awaiting_input` when the turn ended to
       *  collect a question-form answer (the client resumes with a follow-up run). */
      status?: "complete" | "awaiting_input";
    }
  | { type: "charge"; credits: number; balanceAfter: number | null }
  | { type: "error"; message: string };

/* -------------------------------------------------------------------------- */
/* Question-form protocol (interactive clarification)                         */
/* -------------------------------------------------------------------------- */

export type FormFieldType = "select" | "radio" | "checkbox" | "text" | "textarea";

export type FormFieldOption = { value: string; label: string; detail?: string };

export type FormField = {
  key: string;
  label: string;
  type: FormFieldType;
  options?: FormFieldOption[];
  default?: string | string[];
  placeholder?: string;
  hint?: string;
  required?: boolean;
};

export type QuestionForm = {
  id: string;
  title: string;
  intro?: string;
  fields: FormField[];
  submitLabel?: string;
};
