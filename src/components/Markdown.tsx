"use client";

// Small, design-matched Markdown renderer used by the AI assessment panel so the
// model can return **bold**, *italic*, lists and GitHub-flavored tables and have
// them render properly (not as literal asterisks/pipes). react-markdown does not
// render raw HTML unless rehype-raw is added, so model output stays safe.

import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";

const components: Components = {
  p: ({ children }) => <p className="my-2 first:mt-0 last:mb-0">{children}</p>,
  strong: ({ children }) => <strong className="font-semibold text-navy-900">{children}</strong>,
  em: ({ children }) => <em className="italic">{children}</em>,
  a: ({ children, href }) => (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="text-gold-600 underline-offset-2 hover:underline"
    >
      {children}
    </a>
  ),
  ul: ({ children }) => <ul className="my-2 list-disc space-y-1 pl-5">{children}</ul>,
  ol: ({ children }) => <ol className="my-2 list-decimal space-y-1 pl-5">{children}</ol>,
  li: ({ children }) => <li>{children}</li>,
  h1: ({ children }) => <p className="mb-1 mt-3 font-semibold text-navy-900">{children}</p>,
  h2: ({ children }) => <p className="mb-1 mt-3 font-semibold text-navy-900">{children}</p>,
  h3: ({ children }) => <p className="mb-1 mt-3 font-semibold text-navy-900">{children}</p>,
  code: ({ children }) => (
    <code className="rounded bg-paper-100 px-1 py-0.5 font-mono text-[0.85em] text-navy-900">{children}</code>
  ),
  blockquote: ({ children }) => (
    <blockquote className="my-2 border-l-2 border-paper-200 pl-3 text-navy-900/65">{children}</blockquote>
  ),
  table: ({ children }) => (
    <div className="my-3 overflow-x-auto">
      <table className="w-full border-collapse text-sm">{children}</table>
    </div>
  ),
  th: ({ children }) => (
    <th className="border border-paper-200 bg-paper-100 px-3 py-1.5 text-left font-semibold text-navy-900">
      {children}
    </th>
  ),
  td: ({ children }) => (
    <td className="border border-paper-200 px-3 py-1.5 align-top text-navy-900/80">{children}</td>
  ),
};

// In inline contexts (e.g. a bullet item) we don't want the wrapping <p> to add
// block margins, so render its children directly.
const inlineComponents: Components = {
  ...components,
  p: ({ children }) => <>{children}</>,
};

// Long-form documents — contracts, and anything else a counterparty reads on
// paper. The default components flatten h1/h2/h3 to one weight, which suits the
// short AI panels they were written for and actively misleads on a legal
// document: a reader scanning for "V. Mandatory Arbitration" needs the section
// headings to be findable, and the document's own title should not look like
// one of its clauses.
const documentComponents: Components = {
  ...components,
  h1: ({ children }) => (
    <h1 className="mb-5 mt-0 font-serif text-2xl font-medium text-navy-900">{children}</h1>
  ),
  h2: ({ children }) => (
    <h2 className="mb-2 mt-7 border-b border-paper-200 pb-1 font-serif text-lg font-medium text-navy-900">
      {children}
    </h2>
  ),
  h3: ({ children }) => (
    <h3 className="mb-1 mt-5 text-sm font-semibold uppercase tracking-wide text-navy-900">
      {children}
    </h3>
  ),
  // Numbered clauses run long and nest sub-paragraphs; give them room to breathe
  // rather than the tight spacing a chat answer wants.
  ol: ({ children }) => <ol className="my-3 list-decimal space-y-3 pl-6">{children}</ol>,
  li: ({ children }) => <li className="leading-relaxed">{children}</li>,
};

export function Markdown({
  children,
  inline = false,
  variant = "default",
}: {
  children: string;
  inline?: boolean;
  variant?: "default" | "document";
}) {
  const chosen = inline
    ? inlineComponents
    : variant === "document"
      ? documentComponents
      : components;
  return (
    <ReactMarkdown remarkPlugins={[remarkGfm]} components={chosen}>
      {children}
    </ReactMarkdown>
  );
}
