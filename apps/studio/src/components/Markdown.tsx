// Minimal markdown-ish renderer (no dep): preserves paragraphs/линеbreaks and
// renders readably. Good enough for inline spec.md review in QuestionFormCard;
// can be upgraded to a real markdown lib later.
export function Markdown({ text, className }: { text: string; className?: string }) {
  return (
    <div className={'whitespace-pre-wrap text-sm leading-relaxed text-foreground ' + (className ?? '')}>{text}</div>
  );
}
