"use client";

import { useState } from "react";
import { SECTION_NAMES } from "./question-utils";
import type { Subtopic } from "./types";

export function SubtopicEditor({
  codes,
  available,
  onChange,
  primaryCode,
  onPrimaryChange,
}: {
  codes: string[];
  available: Subtopic[];
  onChange: (codes: string[]) => void;
  primaryCode?: string | null;
  onPrimaryChange?: (code: string | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");

  const removeTopic = (code: string) => {
    onChange(codes.filter((c) => c !== code));
    if (primaryCode === code) onPrimaryChange?.(null);
  };

  const addTopic = (code: string) => {
    if (!codes.includes(code)) {
      onChange([...codes, code].sort());
    }
    setSearch("");
    setOpen(false);
  };

  // Group available by section, filter by search and already-selected
  const filtered = available.filter(
    (s) =>
      !codes.includes(s.code) &&
      (search === "" ||
        s.code.toLowerCase().includes(search.toLowerCase()) ||
        s.descriptor.toLowerCase().includes(search.toLowerCase()))
  );

  const grouped = filtered.reduce(
    (acc, s) => {
      if (!acc[s.section]) acc[s.section] = [];
      acc[s.section].push(s);
      return acc;
    },
    {} as Record<number, Subtopic[]>
  );

  return (
    <div className="relative">
      <div className="flex flex-wrap items-center gap-1">
        {codes.map((c) => {
          const sub = available.find((s) => s.code === c);
          const autoSolo = codes.length === 1; // single code is implicitly primary
          const isPrimary = autoSolo || primaryCode === c;
          return (
            <span
              key={c}
              className={`inline-flex items-center gap-0.5 rounded-full px-2 py-0.5 text-xs font-semibold ${
                isPrimary
                  ? "bg-amber-100 text-amber-800 ring-1 ring-amber-400"
                  : "bg-blue-100 text-blue-800"
              }`}
            >
              {isPrimary && <span title="Primary skill">★</span>}
              {c}{sub?.descriptor ? ` ${sub.descriptor}` : ""}
              {onPrimaryChange && !autoSolo && (
                <button
                  type="button"
                  onClick={() => onPrimaryChange(isPrimary ? null : c)}
                  className={`ml-0.5 font-bold leading-none ${
                    isPrimary ? "text-amber-500 hover:text-gray-500" : "text-blue-300 hover:text-amber-500"
                  }`}
                  title={isPrimary ? "Unset as primary skill" : "Set as primary skill"}
                >
                  {isPrimary ? "★" : "☆"}
                </button>
              )}
              <button
                type="button"
                onClick={() => removeTopic(c)}
                className="ml-0.5 text-blue-500 hover:text-red-600 font-bold leading-none"
                title="Remove"
              >
                ×
              </button>
            </span>
          );
        })}
        <button
          type="button"
          onClick={() => setOpen(!open)}
          className="inline-flex items-center rounded-full border border-dashed border-blue-300 px-2 py-0.5 text-xs font-semibold text-blue-600 hover:bg-blue-50"
        >
          + Add
        </button>
      </div>

      {open && (
        <div className="absolute left-0 top-full z-50 mt-1 w-72 rounded-lg border border-blue-200 bg-white shadow-lg">
          <div className="p-2">
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search subtopics..."
              autoFocus
              className="w-full rounded border border-blue-300 px-2 py-1 text-xs font-semibold text-blue-900 focus:ring-1 focus:ring-blue-500"
            />
          </div>
          <div className="max-h-48 overflow-y-auto px-1 pb-2">
            {Object.entries(grouped).length === 0 && (
              <p className="px-2 py-1 text-xs text-gray-400">No matches</p>
            )}
            {Object.entries(grouped)
              .sort(([a], [b]) => Number(a) - Number(b))
              .map(([sec, subs]) => (
                <div key={sec}>
                  <div className="sticky top-0 bg-white px-2 py-0.5 text-xs font-bold text-gray-500">
                    {sec}. {SECTION_NAMES[Number(sec)] ?? "Other"}
                  </div>
                  {subs.map((s) => (
                    <button
                      key={s.code}
                      type="button"
                      onClick={() => addTopic(s.code)}
                      className="block w-full px-3 py-1 text-left text-xs hover:bg-blue-50 rounded"
                    >
                      <span className="font-bold text-blue-800">{s.code}</span>{" "}
                      <span className="text-gray-600">{s.descriptor}</span>
                    </button>
                  ))}
                </div>
              ))}
          </div>
          <div className="border-t border-blue-100 p-1">
            <button
              type="button"
              onClick={() => { setOpen(false); setSearch(""); }}
              className="w-full rounded px-2 py-1 text-xs font-bold text-gray-600 hover:bg-gray-100"
            >
              Close
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
