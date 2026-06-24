import { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronRight, Lock } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { fetchFileContent, type FormField, type QuestionForm, type QuestionFormAnswers } from '@/lib/runs';
import { Markdown } from '@/components/Markdown';
import { useT } from '@/lib/i18n';

interface Props {
  form: QuestionForm;
  /** True after the user submits this form — render in disabled / locked
   *  state so the card sticks around in the chat log without re-submission. */
  locked?: boolean;
  /** Submitted answers, when locked. Used to render the chosen values. */
  lockedAnswers?: QuestionFormAnswers['answers'];
  onSubmit?: (answers: QuestionFormAnswers) => void;
  /** Project path — only used by spec-approval forms to fetch .ogf/spec.md
   *  for inline review. Other form ids ignore it. */
  projectPath?: string;
  /** When set + form is unlocked + no required fields are missing, the card
   *  auto-submits after this many seconds of inactivity. Any user interaction
   *  with the form cancels the timer. */
  autoSubmitSeconds?: number;
}

function defaultValueFor(field: FormField): string | string[] {
  if (field.default !== undefined) return field.default;
  if (field.type === 'checkbox') return [];
  if ((field.type === 'select' || field.type === 'radio') && field.options?.length) {
    return field.options[0].value;
  }
  return '';
}

export function QuestionFormCard(props: Props) {
  const t = useT();
  const initial = useMemo(() => {
    if (props.lockedAnswers) return props.lockedAnswers;
    const o: Record<string, string | string[]> = {};
    for (const f of props.form.fields) o[f.key] = defaultValueFor(f);
    return o;
  }, [props.form, props.lockedAnswers]);

  const [values, setValues] = useState<Record<string, string | string[]>>(initial);

  // Collapsible state for locked (post-submit) cards. Default-collapsed when
  // the form is ALREADY locked at mount (e.g. after a refresh that rebuilds
  // history with submitted forms). Also auto-collapses on the unlocked→locked
  // transition (live submit).
  const [collapsed, setCollapsed] = useState<boolean>(props.locked === true);
  const lockedRef = useRef(props.locked);
  useEffect(() => {
    if (!lockedRef.current && props.locked) setCollapsed(true);
    lockedRef.current = props.locked;
  }, [props.locked]);

  function setField(key: string, v: string | string[]) {
    setValues((prev) => ({ ...prev, [key]: v }));
    cancelAutoSubmit();
  }

  function missingRequired(): string[] {
    const out: string[] = [];
    for (const f of props.form.fields) {
      if (!f.required) continue;
      const v = values[f.key];
      const empty = Array.isArray(v) ? v.length === 0 : !v;
      if (empty) out.push(f.label);
    }
    return out;
  }

  function submit() {
    if (!props.onSubmit) return;
    if (missingRequired().length > 0) return;
    props.onSubmit({ formId: props.form.id, answers: values });
  }

  // Auto-submit countdown. Pauses on any user interaction (field change, focus,
  // click anywhere on the card). Skips when required fields are still empty.
  const autoEnabled = !!props.autoSubmitSeconds && !props.locked;
  const [secondsLeft, setSecondsLeft] = useState(props.autoSubmitSeconds ?? 0);
  const [autoActive, setAutoActive] = useState(autoEnabled);
  const submitRef = useRef(submit);
  const missingRef = useRef(missingRequired);
  submitRef.current = submit;
  missingRef.current = missingRequired;

  useEffect(() => {
    if (!autoActive) return;
    const id = window.setInterval(() => {
      setSecondsLeft((s) => {
        if (s <= 1) {
          window.clearInterval(id);
          window.setTimeout(() => {
            if (missingRef.current().length === 0) submitRef.current();
            setAutoActive(false);
          }, 0);
          return 0;
        }
        return s - 1;
      });
    }, 1000);
    return () => window.clearInterval(id);
  }, [autoActive]);

  function cancelAutoSubmit() {
    if (autoActive) setAutoActive(false);
  }

  const isCollapsed = props.locked && collapsed;
  const missing = missingRequired();

  return (
    <div
      className={cn(
        'rounded-lg bg-card text-card-foreground shadow-sm',
        props.locked && 'opacity-95',
      )}
      onClickCapture={cancelAutoSubmit}
      onFocusCapture={cancelAutoSubmit}
    >
      <div
        className={cn(
          'flex items-center gap-2 px-3 py-2.5',
          !isCollapsed && 'pb-1',
          props.locked && 'cursor-pointer select-none',
        )}
        onClick={() => {
          if (props.locked) setCollapsed((v) => !v);
        }}
      >
        {props.locked ? (
          <ChevronRight
            className={cn('size-4 shrink-0 text-muted-foreground transition-transform', !collapsed && 'rotate-90')}
            aria-hidden
          />
        ) : null}
        <span className="text-sm font-medium">{props.form.title}</span>
        {props.locked ? (
          <span className="ml-auto inline-flex items-center gap-1 rounded-md bg-muted px-1.5 py-0.5 text-[11px] font-medium text-muted-foreground">
            <Lock className="size-3" />
            {t('form.submitted')}
          </span>
        ) : null}
        {autoActive && !props.locked ? (
          <button
            type="button"
            className="ml-auto rounded-md px-1.5 py-0.5 text-[11px] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            onClick={(e) => {
              e.stopPropagation();
              setAutoActive(false);
            }}
          >
            {t('form.autoSubmit', { countdown: formatCountdown(secondsLeft) })}
          </button>
        ) : null}
      </div>

      {!isCollapsed ? (
        <div className="space-y-3 p-3">
          {props.form.intro ? (
            <p className="text-sm text-muted-foreground">{props.form.intro}</p>
          ) : null}

          {props.form.id === 'spec-approval' && props.projectPath ? (
            <SpecViewer projectPath={props.projectPath} />
          ) : null}

          <div className="space-y-4">
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

          {!props.locked ? (
            <div className="flex items-center justify-end gap-3 pt-1">
              {missing.length > 0 ? (
                <span className="text-xs text-muted-foreground">{t('form.need', { fields: missing.join(', ') })}</span>
              ) : null}
              <Button size="sm" onClick={submit} disabled={missing.length > 0}>
                {props.form.submitLabel ?? t('form.submit')}
              </Button>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function FormFieldRow({
  field,
  value,
  locked,
  onChange,
}: {
  field: FormField;
  value: string | string[] | undefined;
  locked: boolean;
  onChange: (v: string | string[]) => void;
}) {
  return (
    <div className="space-y-1.5">
      <Label className="text-sm">{field.label}</Label>
      {field.hint ? <p className="text-xs text-muted-foreground">{field.hint}</p> : null}
      {renderInput(field, value, locked, onChange)}
    </div>
  );
}

function renderInput(
  field: FormField,
  value: string | string[] | undefined,
  locked: boolean,
  onChange: (v: string | string[]) => void,
) {
  switch (field.type) {
    case 'select':
      return (
        <select
          className={cn(
            'h-9 w-full rounded-md border border-input bg-background px-3 text-sm shadow-xs outline-none transition-shadow focus-visible:ring-2 focus-visible:ring-ring/60 disabled:cursor-not-allowed disabled:opacity-50',
          )}
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
        <RadioGroup
          value={typeof value === 'string' ? value : ''}
          disabled={locked}
          onValueChange={(v) => onChange(v)}
        >
          {(field.options ?? []).map((o) => {
            const id = `${field.key}-${o.value}`;
            const active = value === o.value;
            return (
              <Label
                key={o.value}
                htmlFor={id}
                className={cn(
                  'flex items-start gap-2.5 rounded-md border border-transparent bg-muted/40 px-3 py-2 font-normal transition-colors',
                  locked ? 'cursor-default' : 'cursor-pointer hover:bg-accent/50',
                  active && 'border-primary/60 bg-accent/40',
                )}
              >
                <RadioGroupItem id={id} value={o.value} className="mt-0.5" />
                <span className="min-w-0">
                  <span className="block text-sm">{o.label}</span>
                  {o.detail ? <span className="block text-xs text-muted-foreground">{o.detail}</span> : null}
                </span>
              </Label>
            );
          })}
        </RadioGroup>
      );
    case 'checkbox': {
      const arr = Array.isArray(value) ? value : [];
      return (
        <div className="grid gap-2">
          {(field.options ?? []).map((o) => {
            const id = `${field.key}-${o.value}`;
            const checked = arr.includes(o.value);
            return (
              <Label
                key={o.value}
                htmlFor={id}
                className={cn(
                  'flex items-start gap-2.5 rounded-md border border-transparent bg-muted/40 px-3 py-2 font-normal transition-colors',
                  locked ? 'cursor-default' : 'cursor-pointer hover:bg-accent/50',
                  checked && 'border-primary/60 bg-accent/40',
                )}
              >
                <Checkbox
                  id={id}
                  checked={checked}
                  disabled={locked}
                  className="mt-0.5"
                  onCheckedChange={(c) => {
                    if (c === true) onChange([...arr, o.value]);
                    else onChange(arr.filter((x) => x !== o.value));
                  }}
                />
                <span className="min-w-0">
                  <span className="block text-sm">{o.label}</span>
                  {o.detail ? <span className="block text-xs text-muted-foreground">{o.detail}</span> : null}
                </span>
              </Label>
            );
          })}
        </div>
      );
    }
    case 'text':
      return (
        <Input
          type="text"
          value={typeof value === 'string' ? value : ''}
          placeholder={field.placeholder}
          disabled={locked}
          onChange={(e) => onChange(e.target.value)}
        />
      );
    case 'textarea':
      return (
        <Textarea
          rows={3}
          className="resize-y"
          value={typeof value === 'string' ? value : ''}
          placeholder={field.placeholder}
          disabled={locked}
          onChange={(e) => onChange(e.target.value)}
        />
      );
  }
}

/** Inline viewer for `.ogf/spec.md` — shown inside the spec-approval form so
 *  the user can scan what they're approving without leaving the chat. Starts
 *  collapsed (a 'View spec' toggle + 1-line summary); click expands the full
 *  markdown body. */
function SpecViewer({ projectPath }: { projectPath: string }) {
  const t = useT();
  const [content, setContent] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchFileContent(projectPath, '.ogf/spec.md')
      .then((r) => {
        if (cancelled) return;
        setContent(r.content ?? '');
      })
      .catch(() => {
        if (cancelled) return;
        setError(t('form.specNotFound'));
      });
    return () => {
      cancelled = true;
    };
  }, [projectPath, t]);

  if (error) {
    return <div className="rounded-md border border-dashed px-3 py-2 text-xs text-muted-foreground">{error}</div>;
  }
  if (content === null) {
    return <div className="rounded-md border border-dashed px-3 py-2 text-xs text-muted-foreground">{t('form.loadingSpec')}</div>;
  }

  const titleMatch = /^#\s+(.+)$/m.exec(content);
  const title = titleMatch ? titleMatch[1].trim() : 'spec.md';
  const phaseCount = (content.match(/^- \[[ x]\] /gim) ?? []).length;

  return (
    <div className="rounded-md bg-muted/30">
      <button
        type="button"
        className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs font-medium transition-colors hover:bg-accent/40"
        onClick={() => setOpen((v) => !v)}
      >
        <ChevronRight className={cn('size-3.5 shrink-0 transition-transform', open && 'rotate-90')} />
        <span className="truncate">{title}</span>
        <span className="ml-auto shrink-0 text-muted-foreground">
          {phaseCount} {phaseCount === 1 ? t('form.phase') : t('form.phases')}
        </span>
      </button>
      {open ? (
        <div className="max-h-72 overflow-auto px-3 py-2">
          <Markdown text={content} />
        </div>
      ) : null}
    </div>
  );
}

/** Format remaining seconds as 'm:ss' when ≥ 60s, plain '<n>s' below. */
function formatCountdown(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}
