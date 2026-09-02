"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { SECTION_NAMES } from "./question-utils";
import type { Subtopic } from "./types";

type Row =
  | { kind: "group"; key: string; label: string }
  | { kind: "option"; key: string; subtopic: Subtopic | null; label: string };

interface SubtopicComboboxProps {
  /** Currently selected subtopic code, or "" for no filter. */
  value: string;
  /** Called with the selected code, or "" when the filter is cleared. */
  onChange: (code: string) => void;
  /** Full subtopic list (typically `filters.subtopics`). */
  subtopics: Subtopic[];
  /** Label for the reset row at the top of the list. */
  allLabel?: string;
  /** Placeholder shown when nothing is selected and the field is empty. */
  placeholder?: string;
  /** Extra classes applied to the outer wrapper. */
  className?: string;
}

/**
 * Type-to-filter subtopic picker.
 *
 * Behaves like the native `<select>` it replaces — controlled by `value`,
 * emits a bare subtopic code through `onChange`, and groups options under
 * their syllabus section — but lets the user narrow 60+ options by typing
 * any part of the code, the descriptor, or the section name.
 *
 * Matching is term-wise and case-insensitive: "4.3 disp" and "disp 4.3"
 * both find "4.3 - Measures of central tendency and dispersion".
 */
export function SubtopicCombobox({
  value,
  onChange,
  subtopics,
  allLabel = "All subtopics",
  placeholder = "All - type to search",
  className = "",
}: SubtopicComboboxProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [highlight, setHighlight] = useState(0);

  const rootRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);

  const selected = useMemo(
    () => subtopics.find((s) => s.code === value) ?? null,
    [subtopics, value]
  );
  const selectedLabel = selected ? `${selected.code} - ${selected.descriptor}` : "";

  // Sort defensively: grouping below assumes sections are contiguous, and the
  // API is not required to return subtopics in section order.
  const ordered = useMemo(
    () =>
      [...subtopics].sort(
        (a, b) =>
          a.section - b.section ||
          a.code.localeCompare(b.code, undefined, { numeric: true })
      ),
    [subtopics]
  );

  const matches = useMemo(() => {
    const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
    if (terms.length === 0) return ordered;
    return ordered.filter((s) => {
      const haystack = `${s.code} ${s.descriptor} ${s.section} ${SECTION_NAMES[s.section] ?? ""}`.toLowerCase();
      return terms.every((t) => haystack.includes(t));
    });
  }, [ordered, query]);

  const rows = useMemo(() => {
    const out: Row[] = [{ kind: "option", key: "__all__", subtopic: null, label: allLabel }];
    let currentSection: number | null = null;
    for (const s of matches) {
      if (s.section !== currentSection) {
        currentSection = s.section;
        out.push({
          kind: "group",
          key: `section-${s.section}`,
          label: `${s.section}. ${SECTION_NAMES[s.section] ?? "Other"}`,
        });
      }
      out.push({ kind: "option", key: s.code, subtopic: s, label: `${s.code} - ${s.descriptor}` });
    }
    return out;
  }, [matches, allLabel]);

  const optionRows = useMemo(
    () => rows.filter((r): r is Extract<Row, { kind: "option" }> => r.kind === "option"),
    [rows]
  );

  const optionIndex = useCallback(
    (row: Row) => optionRows.findIndex((o) => o.key === row.key),
    [optionRows]
  );

  const commit = useCallback(
    (subtopic: Subtopic | null) => {
      onChange(subtopic ? subtopic.code : "");
      setQuery("");
      setOpen(false);
      inputRef.current?.blur();
    },
    [onChange]
  );

  const openList = useCallback(() => {
    setQuery("");
    setOpen(true);
  }, []);

  // Keep the highlight inside bounds as the filtered list shrinks.
  useEffect(() => {
    setHighlight((h) => (h >= optionRows.length ? Math.max(0, optionRows.length - 1) : h));
  }, [optionRows.length]);

  // When the list opens with no query, start on the currently selected row.
  useEffect(() => {
    if (!open) return;
    const idx = optionRows.findIndex((o) => o.subtopic?.code === value);
    setHighlight(idx >= 0 ? idx : 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Typing restarts the highlight at the best match.
  useEffect(() => {
    if (query) setHighlight(0);
  }, [query]);

  useEffect(() => {
    if (!open || !listRef.current) return;
    const el = listRef.current.querySelector<HTMLElement>(`[data-option-index="${highlight}"]`);
    el?.scrollIntoView({ block: "nearest" });
  }, [highlight, open]);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: MouseEvent | TouchEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false);
        setQuery("");
      }
    };
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("touchstart", onPointerDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("touchstart", onPointerDown);
    };
  }, [open]);

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      if (!open) { openList(); return; }
      setHighlight((h) => Math.min(h + 1, optionRows.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      if (!open) { openList(); return; }
      setHighlight((h) => Math.max(h - 1, 0));
    } else if (e.key === "Home" && open) {
      e.preventDefault();
      setHighlight(0);
    } else if (e.key === "End" && open) {
      e.preventDefault();
      setHighlight(Math.max(0, optionRows.length - 1));
    } else if (e.key === "Enter") {
      if (!open) return;
      e.preventDefault();
      const row = optionRows[highlight];
      if (row) commit(row.subtopic);
    } else if (e.key === "Escape") {
      e.preventDefault();
      setOpen(false);
      setQuery("");
      inputRef.current?.blur();
    } else if (e.key === "Tab") {
      setOpen(false);
      setQuery("");
    }
  };

  const displayValue = open ? query : selectedLabel;
  const inputPlaceholder = open && selectedLabel ? selectedLabel : placeholder;

  return (
    <div ref={rootRef} className={`relative ${className}`}>
      <input
        ref={inputRef}
        type="text"
        role="combobox"
        aria-expanded={open}
        aria-autocomplete="list"
        aria-controls="subtopic-combobox-list"
        suppressHydrationWarning
        value={displayValue}
        placeholder={inputPlaceholder}
        onFocus={openList}
        onClick={openList}
        onChange={(e) => { setQuery(e.target.value); setOpen(true); }}
        onKeyDown={onKeyDown}
        className="input-dark w-full rounded border-2 border-blue-400/40 bg-da-surface py-1.5 pl-3 pr-14 text-sm font-semibold text-blue-300 placeholder:font-medium placeholder:text-blue-400 focus:border-blue-600 focus:ring-2 focus:ring-blue-500"
      />

      <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center gap-1 pr-2">
        {value && (
          <button
            type="button"
            aria-label="Clear subtopic filter"
            title="Clear subtopic filter"
            onMouseDown={(e) => { e.preventDefault(); commit(null); }}
            className="pointer-events-auto flex h-5 w-5 items-center justify-center rounded-full text-blue-500 hover:bg-blue-500/25 hover:text-blue-200"
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        )}
        <svg className="text-blue-500" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </div>

      {open && (
        <div
          ref={listRef}
          id="subtopic-combobox-list"
          role="listbox"
          className="absolute left-0 right-0 z-50 mt-1 max-h-72 overflow-y-auto rounded-lg border-2 border-blue-400/40 bg-da-surface shadow-xl"
        >
          {optionRows.length === 1 && query.trim() !== "" && (
            <p className="px-3 py-3 text-sm font-semibold text-blue-500">
              No subtopic matches &ldquo;{query.trim()}&rdquo;.
            </p>
          )}
          {rows.map((row) => {
            if (row.kind === "group") {
              return (
                <p
                  key={row.key}
                  className="sticky top-0 z-10 border-b border-blue-400/40 bg-blue-500/15 px-3 py-1 text-xs font-bold uppercase tracking-wide text-blue-300"
                >
                  {row.label}
                </p>
              );
            }
            const idx = optionIndex(row);
            const isHighlighted = idx === highlight;
            const isSelected = row.subtopic ? row.subtopic.code === value : value === "";
            return (
              <button
                key={row.key}
                type="button"
                role="option"
                aria-selected={isSelected}
                data-option-index={idx}
                onMouseEnter={() => setHighlight(idx)}
                onMouseDown={(e) => { e.preventDefault(); commit(row.subtopic); }}
                className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm font-semibold transition-colors ${
                  isHighlighted ? "bg-blue-600 text-white" : "text-blue-300 hover:bg-blue-500/25"
                } ${row.subtopic === null ? "border-b border-blue-400/40" : ""}`}
              >
                <span className={`w-3 shrink-0 text-xs ${isHighlighted ? "text-white" : "text-blue-300"}`}>
                  {isSelected ? "\u2713" : ""}
                </span>
                <span className="truncate">{row.label}</span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

export default SubtopicCombobox;
