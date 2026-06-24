/**
 * Question-form helpers — parse the loose `emit_question_form` tool arguments
 * into a well-typed QuestionForm spec, and format submitted answers into the
 * prose block the agent reads on the FOLLOW-UP run.
 *
 * Design (parity with studio): the agent emits a structured clarifying question;
 * the run ends that turn cleanly with an `awaiting_input` status instead of
 * holding the SSE stream open. The client renders the form, and on submit POSTs
 * a NEW run whose prompt is `formatFormAnswers(...)` — so the answer becomes the
 * next user turn and the agent continues. No fragile long-lived paused sockets.
 */
import type { FormField, FormFieldOption, FormFieldType, QuestionForm } from "./events";

const FIELD_TYPES: FormFieldType[] = ["select", "radio", "checkbox", "text", "textarea"];

function asString(v: unknown): string | undefined {
  return typeof v === "string" && v.trim() ? v : undefined;
}

function parseOption(raw: unknown): FormFieldOption | null {
  if (typeof raw === "string") return { value: raw, label: raw };
  if (raw && typeof raw === "object") {
    const o = raw as Record<string, unknown>;
    const value = asString(o.value) ?? asString(o.label);
    if (!value) return null;
    return {
      value,
      label: asString(o.label) ?? value,
      detail: asString(o.detail),
    };
  }
  return null;
}

function parseField(raw: unknown, idx: number): FormField | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const key = asString(o.key) ?? asString(o.name) ?? `field_${idx}`;
  const label = asString(o.label) ?? key;
  const type = (asString(o.type) as FormFieldType | undefined) ?? "text";
  const safeType: FormFieldType = FIELD_TYPES.includes(type) ? type : "text";
  const options = Array.isArray(o.options)
    ? o.options.map(parseOption).filter((x): x is FormFieldOption => x !== null)
    : undefined;
  const field: FormField = { key, label, type: safeType };
  if (options && options.length) field.options = options;
  if (asString(o.placeholder)) field.placeholder = asString(o.placeholder);
  if (asString(o.hint)) field.hint = asString(o.hint);
  if (o.required === true) field.required = true;
  if (typeof o.default === "string" || Array.isArray(o.default)) {
    field.default = o.default as string | string[];
  }
  return field;
}

/**
 * Coerce the raw `emit_question_form` arguments into a QuestionForm. Tolerant of
 * a model that omits/loosely types fields. Returns null only when there's not
 * even an id+title to render.
 */
export function parseQuestionForm(args: Record<string, unknown>): QuestionForm | null {
  const id = asString(args.id);
  const title = asString(args.title);
  if (!id || !title) return null;
  const rawFields = Array.isArray(args.fields) ? args.fields : [];
  const fields = rawFields
    .map((f, i) => parseField(f, i))
    .filter((f): f is FormField => f !== null);
  return {
    id,
    title,
    intro: asString(args.intro),
    fields,
    submitLabel: asString(args.submitLabel),
  };
}

/**
 * Format submitted answers as the prose block the agent reads on the next turn.
 * Mirrors studio's `formatFormAnswers` so the agent sees an identical payload.
 */
export function formatFormAnswers(formId: string, answers: Record<string, string | string[]>): string {
  const lines: string[] = [`## Form answers (id=${formId})`, ""];
  for (const [key, value] of Object.entries(answers)) {
    if (Array.isArray(value)) {
      lines.push(`- **${key}**: ${value.join(", ") || "(none)"}`);
    } else {
      lines.push(`- **${key}**: ${value}`);
    }
  }
  return lines.join("\n");
}
