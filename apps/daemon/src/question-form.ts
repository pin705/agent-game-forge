// Splits agent text into prose + structured form events.
//
// Agent emits: <question-form id="game-discovery">{...JSON...}</question-form>
//
// We extract the JSON, parse it, emit a typed form event, and strip the raw
// XML from the visible text so the user sees the prose around it instead of
// looking at machine syntax.

import type { AgentEvent, QuestionForm } from '@ogf/contracts';

const FORM_RE = /<question-form\b([^>]*)>([\s\S]*?)<\/question-form>/g;
const ID_ATTR_RE = /id\s*=\s*["']([^"']+)["']/;

interface SplitResult {
  events: AgentEvent[];
  /** True when at least one form was successfully extracted. */
  hadForm: boolean;
}

/** Pull <question-form> blocks out of an agent text chunk and return the
 *  expanded sequence of events: the surrounding prose as one or more
 *  text_delta, plus a `form` event for each block.
 *
 *  Forms with malformed JSON are left in the text untouched so the user can
 *  see what went wrong (and Codex sees its own broken output to self-correct
 *  on the next turn).
 */
export function splitFormsFromText(text: string): SplitResult {
  if (!text.includes('<question-form')) {
    return {
      events: text ? [{ type: 'text_delta', delta: text }] : [],
      hadForm: false,
    };
  }

  const out: AgentEvent[] = [];
  let cursor = 0;
  let hadForm = false;
  // FORM_RE has the /g flag — re-create per call so cursor state is fresh.
  const re = new RegExp(FORM_RE.source, FORM_RE.flags);
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const before = text.slice(cursor, m.index);
    if (before) out.push({ type: 'text_delta', delta: before });

    const form = tryParseForm(m[1], m[2]);
    if (form) {
      out.push({ type: 'form', form });
      hadForm = true;
    } else {
      // Couldn't parse — keep raw text so it doesn't silently disappear.
      out.push({ type: 'text_delta', delta: m[0] });
    }
    cursor = m.index + m[0].length;
  }
  const tail = text.slice(cursor);
  if (tail) out.push({ type: 'text_delta', delta: tail });
  return { events: out, hadForm };
}

function tryParseForm(attrs: string, body: string): QuestionForm | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body.trim());
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object') return null;
  const obj = parsed as Record<string, unknown>;

  // Allow id to come from either the attribute OR the JSON body.
  const idMatch = ID_ATTR_RE.exec(attrs);
  const id =
    typeof obj.id === 'string'
      ? obj.id
      : idMatch
        ? idMatch[1]
        : null;
  if (!id) return null;

  const title =
    typeof obj.title === 'string' && obj.title.trim() ? obj.title : id;
  const fields = Array.isArray(obj.fields) ? obj.fields : [];
  if (fields.length === 0) return null;

  return {
    id,
    title,
    intro: typeof obj.intro === 'string' ? obj.intro : undefined,
    submitLabel:
      typeof obj.submitLabel === 'string' ? obj.submitLabel : undefined,
    fields: fields as QuestionForm['fields'],
  };
}

/** Render a user's form answers as a prose block to feed back as the next
 *  turn's prompt. Codex reads this as 'the user filled the form, here's
 *  what they picked' and continues without re-asking. */
export function renderAnswersAsPrompt(
  formId: string,
  answers: Record<string, string | string[]>,
): string {
  const lines: string[] = [`## Form answers (id=${formId})`, ''];
  for (const [key, value] of Object.entries(answers)) {
    if (Array.isArray(value)) {
      lines.push(`- **${key}**: ${value.join(', ') || '(none)'}`);
    } else {
      lines.push(`- **${key}**: ${value}`);
    }
  }
  return lines.join('\n');
}
