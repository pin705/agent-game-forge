// Question-form protocol — agent-emitted structured questions that OGF
// renders as interactive UI.
//
// Agent emits `<question-form id="...">{...JSON...}</question-form>` inline
// in its text output. The daemon scans the stream, extracts the block, parses
// the JSON, and emits a typed `form` event to the UI. The UI renders the form
// and blocks further input until the user submits. The user's answers feed
// back into the next turn as a structured prose block the agent reads.

export type FormFieldType = 'select' | 'radio' | 'checkbox' | 'text' | 'textarea';

export interface FormFieldOption {
  /** Machine value sent back in answers. */
  value: string;
  /** Human-readable label shown in the UI. */
  label: string;
  /** Optional sub-line explaining the choice. */
  detail?: string;
}

export interface FormField {
  /** Unique key within this form. Becomes the answer object key. */
  key: string;
  /** Human-readable question text. */
  label: string;
  /** Field shape — drives the rendered control. */
  type: FormFieldType;
  /** For select / radio / checkbox. */
  options?: FormFieldOption[];
  /** Default value (string for select/radio/text/textarea, string[] for checkbox). */
  default?: string | string[];
  /** Placeholder for text / textarea. */
  placeholder?: string;
  /** Optional helper text shown beneath the question. */
  hint?: string;
  /** When true, blocks submit if empty / nothing selected. */
  required?: boolean;
}

export interface QuestionForm {
  /** Stable id, also used as the answer block id when feeding back. */
  id: string;
  /** Title shown at the top of the rendered form. */
  title: string;
  /** Optional intro text. */
  intro?: string;
  fields: FormField[];
  /** Override for the submit button label. */
  submitLabel?: string;
}

/** Answers shape sent back to the daemon when user submits. */
export interface QuestionFormAnswers {
  formId: string;
  answers: Record<string, string | string[]>;
}
