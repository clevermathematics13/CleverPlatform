"use client";

import { useState } from "react";

export function CommandTermCombobox({
  value,
  onChange,
  disabled,
  options,
  className,
  onEnterCommit,
  "data-part-id": dataPartId,
  "data-field": dataField,
}: {
  value: string;
  onChange: (v: string) => void;
  disabled?: boolean;
  options: string[];
  className?: string;
  onEnterCommit?: () => void;
  "data-part-id"?: string;
  "data-field"?: string;
}) {
  const [query, setQuery] = useState(value);
  const [open, setOpen] = useState(false);

  // Sync display text when value changes externally
  if (query !== value && !open) setQuery(value);

  const filtered = query.trim()
    ? options.filter((o) => o.toLowerCase().startsWith(query.trim().toLowerCase()))
    : options;
  const topMatch = filtered[0] ?? null;

  function commit(term: string) {
    onChange(term);
    setQuery(term);
    setOpen(false);
  }

  return (
    <div className="relative">
      <input
        value={query}
        disabled={disabled}
        data-part-id={dataPartId}
        data-field={dataField}
        placeholder="Term…"
        autoComplete="off"
        className={className}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
          if (e.target.value === "") onChange("");
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => {
          // Delay so onMouseDown on a list item fires first
          setTimeout(() => {
            setOpen(false);
            const match = options.find(
              (o) => o.toLowerCase() === query.trim().toLowerCase()
            );
            if (match) onChange(match);
            else setQuery(value); // revert if not a valid term
          }, 120);
        }}
        onKeyDown={(e) => {
          if (e.key === "Tab") {
            if (topMatch) commit(topMatch);
            // allow natural Tab to move focus
          } else if (e.key === "Enter") {
            e.preventDefault();
            if (topMatch) commit(topMatch);
            onEnterCommit?.();
          } else if (e.key === "Escape") {
            setOpen(false);
            setQuery(value);
          } else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
            e.preventDefault(); // prevent scroll
          }
        }}
      />
      {open && filtered.length > 0 && (
        <ul className="absolute z-50 top-full left-0 right-0 max-h-40 overflow-auto bg-white border border-slate-300 rounded shadow-md text-xs">
          {filtered.map((term, i) => (
            <li
              key={term}
              onMouseDown={(e) => { e.preventDefault(); commit(term); }}
              className={`px-2 py-1 cursor-pointer ${i === 0 ? "bg-blue-50 text-blue-700 font-medium" : "hover:bg-slate-100"}`}
            >
              {term}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

