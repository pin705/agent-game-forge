"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronRight, Lock } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Markdown } from "@/components/markdown";
import { useT } from "@/lib/i18n";
import type { FormField, QuestionForm } from "@/lib/agent/events";

export type FormAnswers = Record<string, string | string[]>;

interface Props {
  form: QuestionForm;
  /** True after submit — renders disabled / collapsible so the card stays in
   *  the chat log without re-submission. */
  locked?: boolean;
  /** Submitted answers, when locked (renders the chosen values). */
  lockedAnswers?: FormAnswers;
  onSubmit?: (formId: string, answers: FormAnswers) => void;
}

function defaultValueFor(field: FormField): string | string[] {
  if (field.default !== undefined) return field.default;
  if (field.type === "checkbox") return [];
  if ((field.type === "select" || field.type === "radio") && field.options?.length) {
    return field.options[0].value;
  }
  return "";
}

export function QuestionFormCard(props: Props) {
  const t = useT();
  const initial = useMemo(() => {
    if (props.lockedAnswers) return props.lockedAnswers;
    const o: FormAnswers = {};
    for (const f of props.form.fields) o[f.key] = defaultValueFor(f);
    return o;
  }, [props.form, props.lockedAnswers]);

  const [values, setValues] = useState<FormAnswers>(initial);

  // Collapsible state for locked (post-submit) cards. Default-collapsed when
  // ALREADY locked at mount (history rebuild); auto-collapse on live submit.
  const [collapsed, setCollapsed] = useState<boolean>(props.locked === true);
  const lockedRef = useRef(props.locked);
  useEffect(() => {
    if (!lockedRef.current && props.locked) setCollapsed(true);
    lockedRef.current = props.locked;
  }, [props.locked]);

  function setField(key: string, v: string | string[]) {
    setValues((prev) => ({ ...prev, [key]: v }));
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
    props.onSubmit(props.form.id, values);
  }

  const isCollapsed = props.locked && collapsed;
  const missing = missingRequired();

  return (
    <div
      className={cn("rounded-lg border bg-card text-card-foreground shadow-sm", props.locked && "opacity-95")}
    >
      <div
        className={cn(
          "flex items-center gap-2 px-3 py-2.5",
          !isCollapsed && "pb-1",
          props.locked && "cursor-pointer select-none",
        )}
        onClick={() => {
          if (props.locked) setCollapsed((v) => !v);
        }}
      >
        {props.locked ? (
          <ChevronRight
            className={cn(
              "size-4 shrink-0 text-muted-foreground transition-transform",
              !collapsed && "rotate-90",
            )}
            aria-hidden
          />
        ) : null}
        <span className="text-sm font-medium">{props.form.title}</span>
        {props.locked ? (
          <span className="ml-auto inline-flex items-center gap-1 rounded-md bg-muted px-1.5 py-0.5 text-[11px] font-medium text-muted-foreground">
            <Lock className="size-3" />
            {t("form.submitted")}
          </span>
        ) : null}
      </div>

      {!isCollapsed ? (
        <div className="space-y-3 p-3">
          {props.form.intro ? <Markdown text={props.form.intro} className="text-muted-foreground" /> : null}

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
                <span className="text-xs text-muted-foreground">
                  {t("form.need", { fields: missing.join(", ") })}
                </span>
              ) : null}
              <Button size="sm" onClick={submit} disabled={missing.length > 0}>
                {props.form.submitLabel ?? t("form.submit")}
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
    case "select":
      return (
        <select
          className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm shadow-sm outline-none transition-shadow focus-visible:ring-2 focus-visible:ring-ring/60 disabled:cursor-not-allowed disabled:opacity-50"
          value={typeof value === "string" ? value : ""}
          disabled={locked}
          onChange={(e) => onChange(e.target.value)}
        >
          {(field.options ?? []).map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
              {o.detail ? ` — ${o.detail}` : ""}
            </option>
          ))}
        </select>
      );
    case "radio":
      return (
        <RadioGroup
          value={typeof value === "string" ? value : ""}
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
                  "flex items-start gap-2.5 rounded-md border border-transparent bg-muted/40 px-3 py-2 font-normal transition-colors",
                  locked ? "cursor-default" : "cursor-pointer hover:bg-accent/50",
                  active && "border-primary/60 bg-accent/40",
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
    case "checkbox": {
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
                  "flex items-start gap-2.5 rounded-md border border-transparent bg-muted/40 px-3 py-2 font-normal transition-colors",
                  locked ? "cursor-default" : "cursor-pointer hover:bg-accent/50",
                  checked && "border-primary/60 bg-accent/40",
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
    case "text":
      return (
        <Input
          type="text"
          value={typeof value === "string" ? value : ""}
          placeholder={field.placeholder}
          disabled={locked}
          onChange={(e) => onChange(e.target.value)}
        />
      );
    case "textarea":
      return (
        <Textarea
          rows={3}
          className="resize-y"
          value={typeof value === "string" ? value : ""}
          placeholder={field.placeholder}
          disabled={locked}
          onChange={(e) => onChange(e.target.value)}
        />
      );
  }
}
