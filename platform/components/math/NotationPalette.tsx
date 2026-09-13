"use client";

/**
 * The notation palette: everyday mathematics on screen, the rest one click away.
 *
 * What lives where is decided in lib/math-notation.ts, not here -- this file
 * is only how it looks. The one behaviour worth knowing about is the
 * onMouseDown preventDefault on every button: without it, pressing a button
 * blurs the field, and the symbol is inserted into nothing.
 */

import { useMemo, useState } from "react";
import katex from "katex";
import {
  ADVANCED_NOTATION,
  BASIC_NOTATION,
  previewLatex,
  type NotationGroup,
  type NotationItem,
} from "@/lib/math-notation";

function NotationButton({
  item,
  onInsert,
}: {
  item: NotationItem;
  onInsert: (latex: string) => void;
}) {
  // Rendered once per item and cached: a hundred KaTeX renders on every
  // keystroke would be a hundred KaTeX renders on every keystroke.
  const html = useMemo(
    () =>
      katex.renderToString(previewLatex(item), {
        throwOnError: false,
        displayMode: false,
      }),
    [item]
  );

  return (
    <button
      type="button"
      title={item.label}
      aria-label={item.label}
      // Keeps focus in the field, so the insert has somewhere to go.
      onMouseDown={(e) => e.preventDefault()}
      onClick={() => onInsert(item.insert)}
      className="flex min-h-9 min-w-9 items-center justify-center rounded-md border border-da-button-border bg-da-button-bg px-2 py-1 text-da-button-text transition-colors hover:border-da-accent/60 hover:bg-da-button-hover focus:outline-none focus-visible:ring-2 focus-visible:ring-da-accent"
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}

function Group({
  group,
  onInsert,
  showTitle,
}: {
  group: NotationGroup;
  onInsert: (latex: string) => void;
  showTitle: boolean;
}) {
  return (
    <div className="min-w-0">
      {showTitle && (
        <h4 className="mb-1.5 font-mono text-[10px] uppercase tracking-wider text-da-muted/70">
          {group.title}
        </h4>
      )}
      <div className="flex flex-wrap gap-1">
        {group.items.map((item) => (
          <NotationButton key={item.id} item={item} onInsert={onInsert} />
        ))}
      </div>
    </div>
  );
}

export default function NotationPalette({
  onInsert,
  disabled = false,
}: {
  onInsert: (latex: string) => void;
  disabled?: boolean;
}) {
  const [advancedOpen, setAdvancedOpen] = useState(false);

  if (disabled) return null;

  return (
    <div className="mt-3 rounded-lg border border-da-border bg-da-bg/50 p-3">
      <div className="flex flex-wrap gap-x-5 gap-y-3">
        {BASIC_NOTATION.map((group) => (
          <Group key={group.id} group={group} onInsert={onInsert} showTitle />
        ))}
      </div>

      <button
        type="button"
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => setAdvancedOpen((open) => !open)}
        aria-expanded={advancedOpen}
        className="mt-3 flex items-center gap-1.5 rounded-md border border-da-border px-2.5 py-1 text-xs text-da-muted transition-colors hover:border-da-accent/50 hover:text-da-text"
      >
        <span aria-hidden="true" className={advancedOpen ? "rotate-90" : ""}>
          &rsaquo;
        </span>
        Advanced notation
      </button>

      {advancedOpen && (
        <div className="mt-3 grid gap-x-6 gap-y-4 border-t border-da-border pt-3 sm:grid-cols-2">
          {ADVANCED_NOTATION.map((group) => (
            <Group key={group.id} group={group} onInsert={onInsert} showTitle />
          ))}
        </div>
      )}
    </div>
  );
}
