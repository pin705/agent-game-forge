"use client";

import { useRef, useState } from "react";
import { useFormStatus } from "react-dom";
import { ArrowRight, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { createProject } from "@/app/(app)/dashboard/actions";
import { useT, type TKey } from "@/lib/i18n";

// English genre seeds — kept stable regardless of UI locale so derived project
// names stay ASCII-friendly (matches studio's GENRES table).
const GENRES: { key: TKey; seed: string }[] = [
  { key: "genre.platformer", seed: "Platformer" },
  { key: "genre.topDown", seed: "Top-down" },
  { key: "genre.towerDefense", seed: "Tower defense" },
  { key: "genre.survivor", seed: "Survivor" },
  { key: "genre.shmup", seed: "Shmup" },
  { key: "genre.gridPuzzle", seed: "Grid puzzle" },
  { key: "genre.cardBattler", seed: "Card battler" },
];

/** Submit button + the spinner — `useFormStatus` reports the form's pending
 *  state (the redirect to /build keeps it pending until navigation). */
function CreateButton() {
  const t = useT();
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      {pending ? (
        <Loader2 className="animate-spin" />
      ) : (
        <>
          {t("newGame.create")}
          <ArrowRight />
        </>
      )}
    </Button>
  );
}

/**
 * Prompt-first dashboard hero (ported from apps/studio/src/pages/Dashboard.tsx):
 * a focus-ring card wrapping a multi-row Textarea + a Create button, plus a row
 * of genre chips. The textarea text (field `idea`) — or "A <genre> game" for a
 * chip — is submitted to the `createProject` server action, which derives the
 * project name, creates the project, and redirects to /build/<id>?idea=… so the
 * build Chat auto-sends it as the first prompt.
 */
export function DashboardCreate() {
  const t = useT();
  const formRef = useRef<HTMLFormElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [idea, setIdea] = useState("");

  // A genre chip PREFILLS the prompt (and focuses it) so the user can add their
  // own details before creating — it does NOT auto-submit. Submit is explicit
  // (the Create button or Enter). This was the "clicking an option submits
  // instantly without letting me type more" bug.
  function fillGenre(seed: string) {
    const v = `A ${seed.toLowerCase()} game`;
    setIdea(v);
    requestAnimationFrame(() => {
      const ta = textareaRef.current;
      if (ta) {
        ta.focus();
        ta.setSelectionRange(v.length, v.length); // cursor at end, ready to elaborate
      }
    });
  }

  return (
    <div className="mt-6 w-full max-w-xl">
      <form ref={formRef} action={createProject}>
        <div className="rounded-xl border bg-card p-3 text-left shadow-sm transition focus-within:ring-2 focus-within:ring-ring">
          <Textarea
            ref={textareaRef}
            name="idea"
            value={idea}
            onChange={(e) => setIdea(e.target.value)}
            rows={3}
            autoFocus
            placeholder={t("newGame.placeholder")}
            aria-label={t("newGame.title")}
            className="resize-none border-0 p-0 shadow-none focus-visible:ring-0"
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                formRef.current?.requestSubmit();
              }
            }}
          />
          <div className="mt-2 flex items-center justify-between gap-2">
            <span className="truncate text-xs text-muted-foreground">{t("dashboard.createHint")}</span>
            <CreateButton />
          </div>
        </div>
      </form>

      <div className="mt-3 flex flex-wrap justify-center gap-2">
        {GENRES.map((g) => (
          <Badge
            key={g.key}
            variant="secondary"
            className="cursor-pointer px-3 py-1 hover:bg-accent"
            role="button"
            tabIndex={0}
            onClick={() => fillGenre(g.seed)}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                fillGenre(g.seed);
              }
            }}
          >
            {t(g.key)}
          </Badge>
        ))}
      </div>
    </div>
  );
}
