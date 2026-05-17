"use client";

import { useState, useEffect, useRef } from "react";

export function CommandTermSelect({
  value,
  terms,
  onChange,
  onAddCustom,
}: {
  value: string | null;
  terms: string[];
  onChange: (term: string | null) => void;
  onAddCustom: (term: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState("");
  const [adding, setAdding] = useState(false);
  const [newTerm, setNewTerm] = useState("");
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    function handleClick(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
        setFilter("");
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [open]);

  const filtered = terms.filter((t) =>
    t.toLowerCase().includes(filter.toLowerCase())
  );

  const handleOpen = () => {
    setOpen(true);
    setFilter("");
    setTimeout(() => inputRef.current?.focus(), 0);
  };

  const handleSelect = (term: string | null) => {
    onChange(term);
    setOpen(false);
    setFilter("");
  };

  const handleAddSubmit = () => {
    const trimmed = newTerm.trim();
    if (trimmed) {
      onAddCustom(trimmed);
      onChange(trimmed);
    }
    setAdding(false);
    setNewTerm("");
    setOpen(false);
  };

  if (adding) {
    return (
      <div className="flex gap-1">
        <input
          type="text"
          value={newTerm}
          onChange={(e) => setNewTerm(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") handleAddSubmit();
            if (e.key === "Escape") { setAdding(false); setNewTerm(""); }
          }}
          placeholder="New term..."
          autoFocus
          className="w-28 rounded border border-blue-300 px-2 py-0.5 text-xs font-semibold text-blue-900 bg-white focus:ring-1 focus:ring-blue-500"
        />
        <button
          type="button"
          onClick={handleAddSubmit}
          className="rounded bg-blue-600 px-2 py-0.5 text-xs font-bold text-white hover:bg-blue-700"
        >
          Add
        </button>
        <button
          type="button"
          onClick={() => { setAdding(false); setNewTerm(""); }}
          className="rounded bg-gray-200 px-2 py-0.5 text-xs font-bold text-gray-700 hover:bg-gray-300"
        >
          ✕
        </button>
      </div>
    );
  }

  return (
    <div ref={containerRef} className="relative inline-block" onClick={(e) => e.stopPropagation()}>
      {/* Trigger */}
      <button
        type="button"
        onClick={handleOpen}
        onFocus={handleOpen}
        className={`rounded border px-2 py-0.5 text-xs font-semibold text-left ${
          value
            ? "border-green-400 bg-green-50 text-green-800"
            : "border-gray-300 bg-white text-gray-500"
        }`}
      >
        {value ?? "— Select —"} <span className="opacity-50">▾</span>
      </button>

      {open && (
        <div className="absolute z-50 mt-1 w-48 rounded border border-gray-200 bg-white shadow-lg">
          {/* Filter input */}
          <div className="p-1.5 border-b border-gray-100">
            <input
              ref={inputRef}
              type="text"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Escape") { setOpen(false); setFilter(""); }
                if (e.key === "Enter" && filtered.length === 1) handleSelect(filtered[0]);
              }}
              placeholder="Type to filter…"
              className="w-full rounded border border-gray-300 px-2 py-1 text-xs text-gray-900 focus:outline-none focus:ring-1 focus:ring-blue-400"
            />
          </div>
          <div className="max-h-48 overflow-y-auto">
            {/* Clear option */}
            {value && (
              <button
                type="button"
                onClick={() => handleSelect(null)}
                className="w-full text-left px-3 py-1.5 text-xs text-red-500 hover:bg-red-50"
              >
                ✕ Clear
              </button>
            )}
            {filtered.length === 0 && (
              <div className="px-3 py-2 text-xs text-gray-400 italic">No matches</div>
            )}
            {filtered.map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => handleSelect(t)}
                className={`w-full text-left px-3 py-1.5 text-xs font-semibold hover:bg-blue-50 ${
                  t === value ? "bg-green-50 text-green-800" : "text-gray-800"
                }`}
              >
                {t}
              </button>
            ))}
            {/* Add custom */}
            <button
              type="button"
              onClick={() => { setOpen(false); setAdding(true); }}
              className="w-full text-left px-3 py-1.5 text-xs text-blue-600 hover:bg-blue-50 border-t border-gray-100"
            >
              + Add custom…
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
