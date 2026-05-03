import { useMemo, useState } from 'react';
import type { QuestionForm, QuestionFormAnswers } from '@ogf/contracts';

interface Props {
  form: QuestionForm;
  /** True after the user submits this form — render in disabled / locked
   *  state so the card sticks around in the chat log without re-submission. */
  locked?: boolean;
  /** Submitted answers, when locked. Used to render the chosen values. */
  lockedAnswers?: QuestionFormAnswers['answers'];
  onSubmit?: (answers: QuestionFormAnswers) => void;
}

function defaultValueFor(field: QuestionForm['fields'][number]): string | string[] {
  if (field.default !== undefined) return field.default;
  if (field.type === 'checkbox') return [];
  if ((field.type === 'select' || field.type === 'radio') && field.options?.length) {
    return field.options[0].value;
  }
  return '';
}

export function QuestionFormCard(props: Props) {
  const initial = useMemo(() => {
    if (props.lockedAnswers) return props.lockedAnswers;
    const o: Record<string, string | string[]> = {};
    for (const f of props.form.fields) o[f.key] = defaultValueFor(f);
    return o;
  }, [props.form, props.lockedAnswers]);

  const [values, setValues] = useState<Record<string, string | string[]>>(initial);

  function setField(key: string, v: string | string[]) {
    setValues((prev) => ({ ...prev, [key]: v }));
  }

  function isComplete(): boolean {
    for (const f of props.form.fields) {
      if (!f.required) continue;
      const v = values[f.key];
      if (Array.isArray(v) ? v.length === 0 : !v) return false;
    }
    return true;
  }

  function submit() {
    if (!props.onSubmit) return;
    if (!isComplete()) return;
    props.onSubmit({ formId: props.form.id, answers: values });
  }

  return (
    <div className={`qform ${props.locked ? 'locked' : ''}`}>
      <div className="qform-head">
        <span className="qform-title">{props.form.title}</span>
        {props.locked && <span className="qform-locked-tag">submitted</span>}
      </div>
      {props.form.intro && <div className="qform-intro">{props.form.intro}</div>}
      <div className="qform-fields">
        {props.form.fields.map((f) => (
          <FormFieldRow
            key={f.key}
            field={f}
            value={values[f.key]}
            locked={!!props.locked}
            onChange={(v) => setField(f.key, v)}
          />
        ))}
      </div>
      {!props.locked && (
        <div className="qform-actions">
          <button
            className="btn btn-sm btn-primary"
            onClick={submit}
            disabled={!isComplete()}
          >
            {props.form.submitLabel ?? 'Submit'}
          </button>
        </div>
      )}
    </div>
  );
}

function FormFieldRow({
  field,
  value,
  locked,
  onChange,
}: {
  field: QuestionForm['fields'][number];
  value: string | string[] | undefined;
  locked: boolean;
  onChange: (v: string | string[]) => void;
}) {
  return (
    <div className="qform-field">
      <label className="qform-label">{field.label}</label>
      {field.hint && <div className="qform-hint">{field.hint}</div>}
      {renderInput(field, value, locked, onChange)}
    </div>
  );
}

function renderInput(
  field: QuestionForm['fields'][number],
  value: string | string[] | undefined,
  locked: boolean,
  onChange: (v: string | string[]) => void,
) {
  switch (field.type) {
    case 'select':
      return (
        <select
          className="qform-select"
          value={typeof value === 'string' ? value : ''}
          disabled={locked}
          onChange={(e) => onChange(e.target.value)}
        >
          {(field.options ?? []).map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
              {o.detail ? ` — ${o.detail}` : ''}
            </option>
          ))}
        </select>
      );
    case 'radio':
      return (
        <div className="qform-radio-group">
          {(field.options ?? []).map((o) => (
            <label
              key={o.value}
              className={`qform-radio-row ${value === o.value ? 'active' : ''} ${locked ? 'locked' : ''}`}
            >
              <input
                type="radio"
                name={field.key}
                value={o.value}
                checked={value === o.value}
                disabled={locked}
                onChange={() => onChange(o.value)}
              />
              <span className="qform-radio-text">
                <span className="qform-radio-label">{o.label}</span>
                {o.detail && <span className="qform-radio-detail">{o.detail}</span>}
              </span>
            </label>
          ))}
        </div>
      );
    case 'checkbox': {
      const arr = Array.isArray(value) ? value : [];
      return (
        <div className="qform-checkbox-group">
          {(field.options ?? []).map((o) => (
            <label
              key={o.value}
              className={`qform-checkbox-row ${arr.includes(o.value) ? 'active' : ''} ${locked ? 'locked' : ''}`}
            >
              <input
                type="checkbox"
                checked={arr.includes(o.value)}
                disabled={locked}
                onChange={(e) => {
                  if (e.target.checked) onChange([...arr, o.value]);
                  else onChange(arr.filter((x) => x !== o.value));
                }}
              />
              <span className="qform-checkbox-text">
                <span className="qform-radio-label">{o.label}</span>
                {o.detail && <span className="qform-radio-detail">{o.detail}</span>}
              </span>
            </label>
          ))}
        </div>
      );
    }
    case 'text':
      return (
        <input
          type="text"
          className="qform-input"
          value={typeof value === 'string' ? value : ''}
          placeholder={field.placeholder}
          disabled={locked}
          onChange={(e) => onChange(e.target.value)}
        />
      );
    case 'textarea':
      return (
        <textarea
          className="qform-textarea"
          rows={3}
          value={typeof value === 'string' ? value : ''}
          placeholder={field.placeholder}
          disabled={locked}
          onChange={(e) => onChange(e.target.value)}
        />
      );
  }
}
