"use client";

import { type ReactNode } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { cn } from "@/lib/utils";

/**
 * Premium markdown rendering (ported from apps/studio Markdown.tsx): real
 * headings, lists, links, tables, blockquotes, inline code, and scrollable code
 * blocks. Each element pulls only the props it needs (no `node` spread → no DOM
 * warnings, clean tsc). Used to render assistant text (including live-streamed
 * deltas) in the chat transcript.
 */
export function Markdown({ text, className }: { text: string; className?: string }) {
  return (
    <div
      className={cn(
        "min-w-0 text-sm leading-normal [&>:first-child]:mt-0 [&>:last-child]:mb-0",
        className,
      )}
    >
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          p: ({ children }) => <p className="my-1.5 break-words">{children}</p>,
          h1: ({ children }) => <h1 className="mb-2 mt-2.5 text-base font-semibold">{children}</h1>,
          h2: ({ children }) => <h2 className="mb-2 mt-2.5 text-[15px] font-semibold">{children}</h2>,
          h3: ({ children }) => <h3 className="mb-1.5 mt-2.5 text-sm font-medium">{children}</h3>,
          ul: ({ children }) => <ul className="my-1.5 list-disc space-y-1 pl-5">{children}</ul>,
          ol: ({ children }) => <ol className="my-1.5 list-decimal space-y-1 pl-5">{children}</ol>,
          li: ({ children }) => <li className="break-words">{children}</li>,
          a: ({ href, children }) => (
            <a
              href={href}
              target="_blank"
              rel="noreferrer"
              className="font-medium text-primary underline underline-offset-2"
            >
              {children}
            </a>
          ),
          strong: ({ children }) => <strong className="font-semibold">{children}</strong>,
          em: ({ children }) => <em className="italic">{children}</em>,
          blockquote: ({ children }) => (
            <blockquote className="my-1.5 border-l-2 border-border pl-3 text-muted-foreground">
              {children}
            </blockquote>
          ),
          hr: () => <hr className="my-3 border-border" />,
          pre: ({ children }) => (
            <pre className="my-1.5 overflow-x-auto rounded-lg border bg-muted/60 p-3 text-xs leading-relaxed">
              {children}
            </pre>
          ),
          code: ({ className: cls, children }: { className?: string; children?: ReactNode }) => {
            const isBlock = /language-/.test(cls ?? "") || String(children).includes("\n");
            if (isBlock) return <code className={cn("font-mono", cls)}>{children}</code>;
            return (
              <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-[0.85em]">{children}</code>
            );
          },
          table: ({ children }) => (
            <div className="my-1.5 overflow-x-auto">
              <table className="w-full border-collapse text-xs">{children}</table>
            </div>
          ),
          th: ({ children }) => (
            <th className="border border-border px-2 py-1 text-left font-medium">{children}</th>
          ),
          td: ({ children }) => <td className="border border-border px-2 py-1">{children}</td>,
          img: ({ src, alt }) => (
            <img
              src={typeof src === "string" ? src : undefined}
              alt={alt}
              className="my-1.5 max-w-full rounded"
            />
          ),
        }}
      >
        {text}
      </ReactMarkdown>
    </div>
  );
}
