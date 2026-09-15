"use client";

import { useMemo, useState } from "react";
import {
  StandardsAssessmentDraftSchema,
  hasBlockingFindings,
  validateStandardsDraft,
  type StandardsAssessmentDraft,
} from "@/lib/standards-import";
import { PERFORMANCE_LEVELS, partRefLabel, type RubricFinding } from "@/lib/standards-rubric";

/**
 * The importer's two halves: get a draft out of the PDFs, then edit and save
 * it. The draft is held as the same StandardsAssessmentDraft the save route
 * validates, and re-validated on every edit with the same function, so the
 * findings on screen are the findings the save will apply.
 */

const field =
  "w-full rounded-lg border border-da-border bg-da-bg px-3 py-2 text-sm text-da-text focus:border-da-accent focus:outline-none disabled:opacity-50";
const small =
  "rounded border border-da-border bg-da-bg px-2 py-1 text-sm text-da-text focus:border-da-accent focus:outline-none";
const labelText = "text-xs font-semibold uppercase tracking-wide text-da-muted";
const hint = "text-xs text-da-muted";

type Phase = "pick" | "extracting" | "review" | "saving";

/** Prefer the Standard Level class when it exists; otherwise the first course. */
function defaultCourseId(courses: { id: string; name: string }[]): string {
  return (
    courses.find((c) => c.name.trim().toLowerCase() === "9d")?.id ??
    courses.find((c) => c.name.toLowerCase().includes("standard"))?.id ??
    courses[0]?.id ??
    ""
  );
}

export function StandardsImportClient({ courses }: { courses: { id: string; name: string }[] }) {
  const [phase, setPhase] = useState<Phase>("pick");
  const [paper, setPaper] = useState<File | null>(null);
  const [rubricFile, setRubricFile] = useState<File | null>(null);
  const [courseId, setCourseId] = useState(() => defaultCourseId(courses));
  const [hidden, setHidden] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState<StandardsAssessmentDraft | null>(null);
  const [serverFindings, setServerFindings] = useState<RubricFinding[]>([]);
  const [openItem, setOpenItem] = useState<number | null>(null);

  const findings = useMemo<RubricFinding[]>(() => {
    if (!draft) return [];
    const parsed = StandardsAssessmentDraftSchema.safeParse(draft);
    if (!parsed.success) {
      return parsed.error.issues.map((i) => ({
        severity: "block" as const,
        message: `${i.path.join(".") || "draft"}: ${i.message}`,
      }));
    }
    return validateStandardsDraft(parsed.data);
  }, [draft]);

  const totalMarks = draft?.items.reduce((s, it) => s + it.maxMarks, 0) ?? 0;

  const extract = async () => {
    if (!paper || !rubricFile) return;
    setPhase("extracting");
    setError(null);
    try {
      const form = new FormData();
      form.append("paper", paper);
      form.append("rubric", rubricFile);
      const res = await fetch("/api/standards-assessments/extract", { method: "POST", body: form });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error ?? `Reading the PDFs failed (${res.status}).`);
        setPhase("pick");
        return;
      }
      setDraft(data.draft);
      setServerFindings(Array.isArray(data.findings) ? data.findings : []);
      setPhase("review");
    } catch {
      setError("Reading the PDFs failed: network error.");
      setPhase("pick");
    }
  };

  const save = async () => {
    if (!draft) return;
    setPhase("saving");
    setError(null);
    try {
      const res = await fetch("/api/standards-assessments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ courseId, draft, hidden }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setServerFindings(Array.isArray(data.findings) ? data.findings : []);
        setError(data.error ?? `Could not save (${res.status}).`);
        setPhase("review");
        return;
      }
      window.location.href = `/dashboard/tests/${data.testId}`;
    } catch {
      setError("Could not save: network error.");
      setPhase("review");
    }
  };

  const update = (patch: Partial<StandardsAssessmentDraft>) => setDraft((d) => (d ? { ...d, ...patch } : d));
  const updateItem = (index: number, patch: Partial<StandardsAssessmentDraft["items"][number]>) =>
    setDraft((d) =>
      d ? { ...d, items: d.items.map((it, i) => (i === index ? { ...it, ...patch } : it)) } : d
    );
  const removeItem = (index: number) =>
    setDraft((d) => (d ? { ...d, items: d.items.filter((_, i) => i !== index) } : d));
  const addItem = () =>
    setDraft((d) =>
      d
        ? {
            ...d,
            items: [
              ...d.items,
              {
                questionNumber: (d.items[d.items.length - 1]?.questionNumber ?? 0) + 1,
                partLabel: "",
                maxMarks: 1,
                questionText: "",
                markschemeText: "",
              },
            ],
          }
        : d
    );
  const updateStrand = (index: number, patch: Partial<StandardsAssessmentDraft["rubric"]["strands"][number]>) =>
    setDraft((d) =>
      d
        ? {
            ...d,
            rubric: { ...d.rubric, strands: d.rubric.strands.map((s, i) => (i === index ? { ...s, ...patch } : s)) },
          }
        : d
    );
  const updateStrandDescriptor = (index: number, level: (typeof PERFORMANCE_LEVELS)[number]["value"], text: string) =>
    setDraft((d) => {
      if (!d) return d;
      const strands = d.rubric.strands.map((s, i) => {
        if (i !== index) return s;
        const descriptors = { ...(s.descriptors ?? {}) };
        if (text.trim()) descriptors[level] = text;
        else delete descriptors[level];
        return { ...s, descriptors: Object.keys(descriptors).length > 0 ? descriptors : undefined };
      });
      return { ...d, rubric: { ...d.rubric, strands } };
    });
  const removeStrand = (index: number) =>
    setDraft((d) => (d ? { ...d, rubric: { ...d.rubric, strands: d.rubric.strands.filter((_, i) => i !== index) } } : d));
  const addStrand = () =>
    setDraft((d) =>
      d
        ? {
            ...d,
            rubric: {
              ...d.rubric,
              strands: [...d.rubric.strands, { code: String.fromCharCode(65 + d.rubric.strands.length), name: "", standards: [], parts: [] }],
            },
          }
        : d
    );

  const allFindings = [...findings, ...serverFindings.filter((f) => !findings.some((g) => g.message === f.message))];
  const blocked = hasBlockingFindings(allFindings);

  // -- Pick ------------------------------------------------------------------
  if (phase === "pick" || phase === "extracting") {
    return (
      <section className="space-y-4 rounded-xl border border-da-border bg-da-surface p-5 shadow-sm">
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="flex flex-col gap-1">
            <span className={labelText}>The paper (PDF)</span>
            <input
              type="file"
              accept="application/pdf,.pdf"
              disabled={phase === "extracting"}
              onChange={(e) => setPaper(e.target.files?.[0] ?? null)}
              className="text-sm text-da-text file:mr-3 file:rounded file:border file:border-da-border file:bg-da-bg file:px-3 file:py-1 file:text-xs file:text-da-text"
            />
            <span className={hint}>What the students sat.</span>
          </label>
          <label className="flex flex-col gap-1">
            <span className={labelText}>Teacher marking rubric (PDF)</span>
            <input
              type="file"
              accept="application/pdf,.pdf"
              disabled={phase === "extracting"}
              onChange={(e) => setRubricFile(e.target.files?.[0] ?? null)}
              className="text-sm text-da-text file:mr-3 file:rounded file:border file:border-da-border file:bg-da-bg file:px-3 file:py-1 file:text-xs file:text-da-text"
            />
            <span className={hint}>Strands, standards, level bands, and what a full-mark response shows.</span>
          </label>
        </div>
        {error && <p className="text-sm text-red-300">{error}</p>}
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={extract}
            disabled={!paper || !rubricFile || phase === "extracting"}
            className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-bold text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {phase === "extracting" ? "Reading the PDFs… (up to a couple of minutes)" : "Read the PDFs"}
          </button>
          <span className={hint}>Nothing is saved at this step.</span>
        </div>
      </section>
    );
  }

  if (!draft) return null;

  // -- Review ----------------------------------------------------------------
  return (
    <div className="space-y-6">
      {/* -- The test ------------------------------------------------------ */}
      <section className="space-y-4 rounded-xl border border-da-border bg-da-surface p-5 shadow-sm">
        <h2 className="font-bold text-da-text">The test</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="flex flex-col gap-1 sm:col-span-2">
            <span className={labelText}>Name</span>
            <input type="text" value={draft.name} onChange={(e) => update({ name: e.target.value })} className={field} />
          </label>
          <label className="flex flex-col gap-1">
            <span className={labelText}>Class</span>
            <select value={courseId} onChange={(e) => setCourseId(e.target.value)} className={field}>
              {courses.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
            <span className={hint}>The real class (9D), not the virtual Grade 9 Standard track.</span>
          </label>
          <label className="flex flex-col gap-1">
            <span className={labelText}>Date sat</span>
            <input
              type="date"
              value={draft.testDate ?? ""}
              onChange={(e) => update({ testDate: e.target.value || null })}
              className={field}
            />
          </label>
        </div>
        <label className="flex items-start gap-2 text-sm text-da-text">
          <input type="checkbox" checked={hidden} onChange={(e) => setHidden(e.target.checked)} className="mt-1" />
          <span>
            Hide from students until I release it
            <span className={`block ${hint}`}>
              Keeps it out of the student reflection dropdown; untick it on the Tests page when the marks
              are ready. Saved as a summative with self-assessment required, like every paper that counts.
            </span>
          </span>
        </label>
        {draft.readerNotes.length > 0 && (
          <div className="rounded-lg border border-amber-400/40 bg-amber-500/10 px-3 py-2">
            <p className="text-xs font-semibold text-amber-300">Clev was unsure about:</p>
            <ul className="mt-1 list-disc space-y-0.5 pl-5 text-xs text-amber-200">
              {draft.readerNotes.map((n, i) => (
                <li key={i}>{n}</li>
              ))}
            </ul>
          </div>
        )}
      </section>

      {/* -- Parts --------------------------------------------------------- */}
      <section className="space-y-3 rounded-xl border border-da-border bg-da-surface p-5 shadow-sm">
        <div className="flex items-baseline justify-between gap-3">
          <h2 className="font-bold text-da-text">Parts and mark schemes</h2>
          <span className={hint}>
            {draft.items.length} part{draft.items.length === 1 ? "" : "s"} · {totalMarks} marks
            {typeof draft.statedTotalMarks === "number" && draft.statedTotalMarks !== totalMarks
              ? ` (the paper says ${draft.statedTotalMarks})`
              : ""}
          </span>
        </div>
        <p className={hint}>
          Click a part to read and edit its question and mark scheme. The mark scheme is what the marker
          grades against, so check the answer and the marks-for-what notes on every part.
        </p>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-da-border text-left text-xs text-da-muted">
                <th className="pb-2 pr-2 font-semibold">Q</th>
                <th className="pb-2 pr-2 font-semibold">Part</th>
                <th className="pb-2 pr-2 font-semibold">Marks</th>
                <th className="pb-2 pr-2 font-semibold">Mark scheme</th>
                <th className="pb-2" />
              </tr>
            </thead>
            <tbody>
              {draft.items.map((it, i) => {
                const open = openItem === i;
                return (
                  <tr key={i} className="border-b border-da-border/50 align-top last:border-0">
                    <td className="py-1.5 pr-2">
                      <input
                        type="number"
                        min={1}
                        value={it.questionNumber}
                        onChange={(e) => updateItem(i, { questionNumber: Number(e.target.value) })}
                        className={`${small} w-14`}
                      />
                    </td>
                    <td className="py-1.5 pr-2">
                      <input
                        type="text"
                        value={it.partLabel}
                        maxLength={8}
                        placeholder="—"
                        onChange={(e) => updateItem(i, { partLabel: e.target.value.trim().toLowerCase() })}
                        className={`${small} w-14`}
                      />
                    </td>
                    <td className="py-1.5 pr-2">
                      <input
                        type="number"
                        min={0}
                        max={50}
                        value={it.maxMarks}
                        onChange={(e) => updateItem(i, { maxMarks: Number(e.target.value) })}
                        className={`${small} w-16`}
                      />
                    </td>
                    <td className="py-1.5 pr-2">
                      {open ? (
                        <div className="space-y-2">
                          <label className="flex flex-col gap-1">
                            <span className={labelText}>Question</span>
                            <textarea
                              value={it.questionText}
                              rows={3}
                              onChange={(e) => updateItem(i, { questionText: e.target.value })}
                              className={`${field} font-mono text-xs`}
                            />
                          </label>
                          <label className="flex flex-col gap-1">
                            <span className={labelText}>Mark scheme</span>
                            <textarea
                              value={it.markschemeText}
                              rows={5}
                              onChange={(e) => updateItem(i, { markschemeText: e.target.value })}
                              className={`${field} font-mono text-xs`}
                            />
                          </label>
                        </div>
                      ) : (
                        <button
                          type="button"
                          onClick={() => setOpenItem(i)}
                          className="block max-w-xl truncate text-left text-xs text-da-muted hover:text-da-text"
                          title="Edit"
                        >
                          {it.markschemeText || <span className="text-red-300">No mark scheme</span>}
                        </button>
                      )}
                    </td>
                    <td className="py-1.5 whitespace-nowrap text-right">
                      <button
                        type="button"
                        onClick={() => setOpenItem(open ? null : i)}
                        className="text-xs text-blue-300 hover:underline"
                      >
                        {open ? "Done" : "Edit"}
                      </button>
                      <button
                        type="button"
                        onClick={() => removeItem(i)}
                        className="ml-3 text-lg leading-none text-red-400 hover:text-red-200"
                        title="Remove this part"
                      >
                        ×
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <button type="button" onClick={addItem} className="text-sm text-blue-300 hover:underline">
          + Add a part
        </button>
      </section>

      {/* -- Strands ------------------------------------------------------- */}
      <section className="space-y-4 rounded-xl border border-da-border bg-da-surface p-5 shadow-sm">
        <h2 className="font-bold text-da-text">Strands and levels</h2>
        <div className="grid gap-3 sm:grid-cols-3">
          {(["exceeding", "meeting", "approaching"] as const).map((level) => (
            <label key={level} className="flex flex-col gap-1">
              <span className={labelText}>{level} from</span>
              <div className="flex items-center gap-1">
                <input
                  type="number"
                  min={1}
                  max={100}
                  value={Math.round(draft.rubric.bands[level] * 100)}
                  onChange={(e) =>
                    update({ rubric: { ...draft.rubric, bands: { ...draft.rubric.bands, [level]: Number(e.target.value) / 100 } } })
                  }
                  className={`${small} w-20`}
                />
                <span className={hint}>% of a strand&apos;s marks</span>
              </div>
            </label>
          ))}
        </div>
        <div className="space-y-4">
          {draft.rubric.strands.map((s, i) => (
            <div key={i} className="space-y-2 rounded-lg border border-da-border p-3">
              <div className="grid gap-2 sm:grid-cols-[5rem_1fr_auto]">
                <label className="flex flex-col gap-1">
                  <span className={labelText}>Code</span>
                  <input type="text" value={s.code} maxLength={8} onChange={(e) => updateStrand(i, { code: e.target.value })} className={small} />
                </label>
                <label className="flex flex-col gap-1">
                  <span className={labelText}>Name</span>
                  <input type="text" value={s.name} onChange={(e) => updateStrand(i, { name: e.target.value })} className={small} />
                </label>
                <button
                  type="button"
                  onClick={() => removeStrand(i)}
                  className="self-end text-xs text-red-300 hover:underline"
                >
                  Remove strand
                </button>
              </div>
              <label className="flex flex-col gap-1">
                <span className={labelText}>Parts (comma separated: 2d, 5)</span>
                <input
                  type="text"
                  value={s.parts.join(", ")}
                  onChange={(e) =>
                    updateStrand(i, {
                      parts: e.target.value
                        .split(",")
                        .map((p) => p.trim().toLowerCase().replace(/[()\s.]/g, ""))
                        .filter(Boolean),
                    })
                  }
                  className={small}
                />
                <span className={hint}>
                  {s.parts.map(partRefLabel).join(", ") || "none"} ·{" "}
                  {s.parts.reduce((sum, p) => {
                    const it = draft.items.find(
                      (x) => `${x.questionNumber}${x.partLabel}`.toLowerCase() === p.toLowerCase()
                    );
                    return sum + (it?.maxMarks ?? 0);
                  }, 0)}{" "}
                  marks
                  {typeof draft.statedStrandMarks[s.code] === "number" ? ` (rubric says ${draft.statedStrandMarks[s.code]})` : ""}
                </span>
              </label>
              <label className="flex flex-col gap-1">
                <span className={labelText}>Standards (one per line)</span>
                <textarea
                  value={s.standards.join("\n")}
                  rows={Math.max(2, s.standards.length)}
                  onChange={(e) => updateStrand(i, { standards: e.target.value.split("\n").map((x) => x.trim()).filter(Boolean) })}
                  className={`${field} text-xs`}
                />
              </label>
              <details>
                <summary className="cursor-pointer text-xs text-da-muted hover:text-da-text">Level descriptors</summary>
                <div className="mt-2 grid gap-2 sm:grid-cols-2">
                  {PERFORMANCE_LEVELS.map((l) => (
                    <label key={l.value} className="flex flex-col gap-1">
                      <span className={labelText}>{l.label}</span>
                      <textarea
                        value={s.descriptors?.[l.value] ?? ""}
                        rows={3}
                        onChange={(e) => updateStrandDescriptor(i, l.value, e.target.value)}
                        className={`${field} text-xs`}
                      />
                    </label>
                  ))}
                </div>
              </details>
            </div>
          ))}
        </div>
        <button type="button" onClick={addStrand} className="text-sm text-blue-300 hover:underline">
          + Add a strand
        </button>
      </section>

      {/* -- Save ---------------------------------------------------------- */}
      <div className="sticky bottom-4 space-y-2 rounded-xl border border-da-border bg-da-surface/95 p-4 shadow-lg backdrop-blur">
        {allFindings.length > 0 && (
          <ul className="space-y-0.5 text-xs">
            {allFindings.map((f, i) => (
              <li key={i} className={f.severity === "block" ? "text-red-300" : "text-amber-300"}>
                {f.severity === "block" ? "✕" : "⚠"} {f.message}
              </li>
            ))}
          </ul>
        )}
        {error && <p className="text-sm text-red-300">{error}</p>}
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={save}
            disabled={blocked || phase === "saving" || !courseId}
            className={`rounded-lg px-4 py-2 text-sm font-bold transition-colors ${
              !blocked && phase !== "saving" && courseId
                ? "bg-blue-600 text-white hover:bg-blue-700"
                : "cursor-not-allowed bg-da-bg text-da-muted"
            }`}
          >
            {phase === "saving" ? "Saving…" : `Save as a test (${draft.items.length} parts, ${totalMarks} marks)`}
          </button>
          <button
            type="button"
            onClick={() => {
              setDraft(null);
              setServerFindings([]);
              setError(null);
              setPhase("pick");
            }}
            disabled={phase === "saving"}
            className="rounded-lg border border-da-border px-4 py-2 text-sm text-da-muted hover:bg-da-hover"
          >
            Start over
          </button>
          {blocked ? (
            <span className={hint}>Fix the items marked ✕ before saving. Warnings do not stop a save.</span>
          ) : (
            <span className={hint}>Opens the new test&apos;s page when saved.</span>
          )}
        </div>
      </div>
    </div>
  );
}
