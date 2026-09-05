"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import type { KeyboardEvent } from "react";
import { filterStudentGroups, type PickableStudent } from "@/lib/student-picker";

interface StudentPickerProps<T extends PickableStudent> {
  students: T[];
  /** Selected subject id, or "" for none. */
  value: string;
  onChange: (profileId: string) => void;
  disabled?: boolean;
  /** Red border, e.g. to flag a duplicate match. */
  invalid?: boolean;
  placeholder?: string;
}

/**
 * Typeahead replacement for the "Matched student" <select>: type the start
 * of a first or last name to narrow the list, which stays grouped by class
 * (9G, then 9A, 9C ...) so a name that exists in two classes is easy to
 * tell apart. Keyboard: arrows move, Enter picks, Escape closes.
 */
export function StudentPicker<T extends PickableStudent>({
  students,
  value,
  onChange,
  disabled,
  invalid,
  placeholder = "Type a name…",
}: StudentPickerProps<T>) {
  const selected = useMemo(() => students.find((s) => s.profile_id === value) ?? null, [students, value]);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [highlight, setHighlight] = useState(0);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const listId = useId();

  const groups = useMemo(() => filterStudentGroups(students, query), [students, query]);
  // Flat list in display order so keyboard navigation can step across
  // groups; the index map lets each option know its position.
  const flat = useMemo(() => groups.flatMap((g) => g.students), [groups]);
  const indexOf = useMemo(() => new Map(flat.map((s, i) => [s.profile_id, i])), [flat]);

  // Close on any click outside the control.
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: PointerEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false);
        setQuery("");
      }
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open]);

  // Keep the highlighted option scrolled into view.
  useEffect(() => {
    if (!open) return;
    const el = rootRef.current?.querySelector<HTMLElement>(`[data-index="${highlight}"]`);
    el?.scrollIntoView({ block: "nearest" });
  }, [highlight, open]);

  function openList() {
    if (open) return;
    setOpen(true);
    setHighlight(0);
  }

  function close() {
    setOpen(false);
    setQuery("");
  }

  function pick(student: T) {
    onChange(student.profile_id);
    close();
    inputRef.current?.blur();
  }

  function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      if (!open) openList();
      else setHighlight((h) => Math.min(h + 1, Math.max(flat.length - 1, 0)));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlight((h) => Math.max(h - 1, 0));
    } else if (e.key === "Enter") {
      if (!open) return;
      e.preventDefault();
      const target = flat[highlight];
      if (target) pick(target);
    } else if (e.key === "Escape") {
      if (open) {
        e.preventDefault();
        close();
      }
    } else if (e.key === "Tab") {
      close();
    }
  }

  const shownValue = open ? query : (selected?.display_name ?? "");

  return (
    <div ref={rootRef} className="relative">
      <div className="flex items-center gap-1">
        <input
          ref={inputRef}
          type="text"
          role="combobox"
          aria-expanded={open}
          aria-controls={listId}
          aria-autocomplete="list"
          value={shownValue}
          disabled={disabled}
          placeholder={selected ? selected.display_name : placeholder}
          onFocus={openList}
          onClick={openList}
          onChange={(e) => {
            setQuery(e.target.value);
            setHighlight(0);
            if (!open) setOpen(true);
          }}
          onKeyDown={onKeyDown}
          className={`w-48 rounded border px-2 py-1 text-sm focus:ring-2 focus:ring-purple-400 disabled:bg-da-hover ${
            invalid ? "border-red-400" : "border-da-border"
          }`}
        />
        {selected?.class_name && !open && (
          <span
            className="shrink-0 rounded border border-da-border bg-da-hover px-1.5 py-0.5 text-[11px] font-medium text-da-muted"
            title={`Class ${selected.class_name}`}
          >
            {selected.class_name}
          </span>
        )}
        {selected && !disabled && (
          <button
            type="button"
            onClick={() => onChange("")}
            title="Clear the matched student"
            aria-label="Clear the matched student"
            className="shrink-0 rounded px-1 text-xs text-da-muted hover:text-da-text"
          >
            ×
          </button>
        )}
      </div>

      {open && !disabled && (
        <ul
          id={listId}
          role="listbox"
          className="absolute left-0 z-20 mt-1 max-h-72 w-64 overflow-y-auto rounded-md border border-da-border bg-da-surface py-1 text-sm shadow-lg"
        >
          {flat.length === 0 && (
            <li className="px-3 py-2 text-xs text-da-muted">
              No student matches &ldquo;{query}&rdquo;. Try the start of a first or last name.
            </li>
          )}
          {groups.map((g) => (
            <li key={g.label} role="presentation">
              <div className="sticky top-0 bg-da-surface px-3 pb-0.5 pt-1.5 text-[11px] font-semibold uppercase tracking-wide text-da-muted">
                {g.label}
              </div>
              <ul role="group" aria-label={g.label}>
                {g.students.map((s) => {
                  const index = indexOf.get(s.profile_id) ?? -1;
                  const isHighlighted = index === highlight;
                  const isSelected = s.profile_id === value;
                  return (
                    <li
                      key={s.profile_id}
                      role="option"
                      aria-selected={isSelected}
                      data-index={index}
                      // pointerdown rather than click so the input's blur
                      // never races the selection.
                      onPointerDown={(e) => {
                        e.preventDefault();
                        pick(s);
                      }}
                      onMouseEnter={() => setHighlight(index)}
                      className={`cursor-pointer px-3 py-1.5 ${
                        isHighlighted ? "bg-da-hover text-da-text" : "text-da-text"
                      } ${isSelected ? "font-semibold" : ""}`}
                    >
                      {s.display_name}
                    </li>
                  );
                })}
              </ul>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
