"use client";

import { useMemo, useState } from "react";
import {
  ActivityDraftSchema,
  MAX_MARKS_PER_PART,
  hasBlockingFindings,
  normaliseTargetCode,
  validateActivityDraft,
  type ActivityDraft,
} from "@/lib/activity-import";
import { ACTIVITY_KINDS, partRefLabel, type RubricFinding } from "@/lib/activity-rubric";

/**
 * The importer's two halves: get a draft out of the PDFs, then edit and save
 * it. The draft is held as the same ActivityDraft the save route validates,
 * and re-validated on every edit with the same function, so the findings on
 * screen are the findings the save will apply.
 */

const field =
  "w-full rounded-lg border border-da-border bg-da-bg px-3 py-2 text-sm text-da-text focus:border-da-accent focus:outline-none disabled:opacity-50";
const small =
  "rounded border border-da-border bg-da-bg px-2 py-1 text-sm text-da-text focus:border-da-accent focus:outline-none";
const labelText = "text-xs font-semibold uppercase tracking-wide text-da-muted";
const hint = "text-xs text-da-muted";

type Phase = "pick" | "extracting" | "review" | "saving";

/** Today, as the date input wants it. Most activities are imported the day they are done. */
function today(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function ActivityImportClient({ courses }: { courses: { id: string; name: string }[] }) {
  const [phase, setPhase] = useState<Phase>("pick");
  const [worksheet, setWorksheet] = useState<File | null>(null);
  const [keyFile, setKeyFile] = useState<File | null>(null);
  const [courseId, setCourseId] = useState(() => courses[0]?.id ?? "");
  const [activityDate, setActivityDate] = useState(today);
  const [showInGradebook, setShowInGradebook] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState<ActivityDraft | null>(null);
  const [serverFindings, setServerFindings] = useState<RubricFinding[]>([]);
  const [openItem, setOpenItem] = useState<number | null>(null);

  const findings = useMemo<RubricFinding[]>(() => {
    if (!draft) return [];
    const parsed = ActivityDraftSchema.safeParse(draft);
    if (!parsed.success) {
      return parsed.error.issues.map((i) => ({
        severity: "block" as const,
        message: `${i.path.join(".") || "draft"}: ${i.message}`,
      }));
    }
    return validateActivityDraft(parsed.data);
  }, [draft]);

  const totalMarks = draft?.items.reduce((s, it) => s + it.maxMarks, 0) ?? 0;

  const extract = async () => {
    if (!worksheet || !keyFile) return;
    setPhase("extracting");
    setError(null);
    try {
      const form = new FormData();
      form.append("worksheet", worksheet);
      form.append("key", keyFile);
      form.append("activityDate", activityDate);
      const res = await fetch("/api/activity-assessments/extract", { method: "POST", body: form });
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
      const res = await fetch("/api/activity-assessments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ courseId, draft, showInGradebook }),
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

  const update = (patch: Partial<ActivityDraft>) => setDraft((d) => (d ? { ...d, ...patch } : d));
  const updateItem = (index: number, patch: Partial<ActivityDraft["items"][number]>) =>
    setDraft((d) => (d ? { ...d, items: d.items.map((it, i) => (i === index ? { ...it, ...patch } : it)) } : d));
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

  const updateTarget = (index: number, patch: Partial<ActivityDraft["rubric"]["targets"][number]>) =>
    setDraft((d) =>
      d
        ? { ...d, rubric: { ...d.rubric, targets: d.rubric.targets.map((t, i) => (i === index ? { ...t, ...patch } : t)) } }
        : d
    );
  const removeTarget = (index: number) =>
    setDraft((d) => (d ? { ...d, rubric: { ...d.rubric, targets: d.rubric.targets.filter((_, i) => i !== index) } } : d));
  const addTarget = () =>
    setDraft((d) =>
      d
        ? {
            ...d,
            rubric: {
              ...d.rubric,
              targets: [...d.rubric.targets, { code: `LT${d.rubric.targets.length + 1}`, name: "", parts: [] }],
            },
          }
        : d
    );

  const allFindings = [...findings, ...serverFindings.filter((f) => !findings.some((g) => g.message === f.message))];
  const blocked = hasBlockingFindings(allFindings);

  // ---- Pick -----------------------------------------------------------------
  if (phase === "pick" || phase === "extracting") {
    return (
      <section className="space-y-4 rounded-xl border border-da-border bg-da-surface p-5 shadow-sm">
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="flex flex-col gap-1">
            <span className={labelText}>The worksheet (PDF)</span>
            <input
              type="file"
              accept="application/pdf,.pdf"
              disabled={phase === "extracting"}
              onChange={(e) => setWorksheet(e.target.files?.[0] ?? null)}
              className="text-sm text-da-text file:mr-3 file:rounded file:border file:border-da-border file:bg-da-bg file:px-3 file:py-1 file:text-xs file:text-da-text"
            />
            <span className={hint}>The blank one the students filled in.</span>
          </label>
          <label className="flex flex-col gap-1">
            <span className={labelText}>The answer key (PDF)</span>
            <input
              type="file"
              accept="application/pdf,.pdf"
              disabled={phase === "extracting"}
              onChange={(e) => setKeyFile(e.target.files?.[0] ?? null)}
              className="text-sm text-da-text file:mr-3 file:rounded file:border file:border-da-border file:bg-da-bg file:px-3 file:py-1 file:text-xs file:text-da-text"
            />
            <span className={hint}>Handwritten answers are fine — Clev reads the page, not its text layer.</span>
          </label>
          <label className="flex flex-col gap-1">
            <span className={labelText}>Date the class did it</span>
            <input
              type="date"
              value={activityDate}
              disabled={phase === "extracting"}
              onChange={(e) => setActivityDate(e.target.value)}
              className={field}
            />
            <span className={hint}>A worksheet never prints one.</span>
          </label>
        </div>
        {error && <p className="text-sm text-red-300">{error}</p>}
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={extract}
            disabled={!worksheet || !keyFile || phase === "extracting"}
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

  const kindLabel = ACTIVITY_KINDS.find((k) => k.value === draft.rubric.kind);

  // ---- Review ---------------------------------------------------------------
  return (
    <div className="space-y-6">
      {/* ---- The activity ---------------------------------------------- */}
      <section className="space-y-4 rounded-xl border border-da-border bg-da-surface p-5 shadow-sm">
        <h2 className="font-bold text-da-text">The activity</h2>
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
          </label>
          <label className="flex flex-col gap-1">
            <span className={labelText}>Date</span>
            <input
              type="date"
              value={draft.activityDate ?? ""}
              onChange={(e) => update({ activityDate: e.target.value || null })}
              className={field}
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className={labelText}>Kind</span>
            <select
              value={draft.rubric.kind}
              onChange={(e) =>
                update({ rubric: { ...draft.rubric, kind: e.target.value as ActivityDraft["rubric"]["kind"] } })
              }
              className={field}
            >
              {ACTIVITY_KINDS.map((k) => (
                <option key={k.value} value={k.value}>
                  {k.label}
                </option>
              ))}
            </select>
            {kindLabel && <span className={hint}>{kindLabel.blurb}</span>}
          </label>
          <label className="flex flex-col gap-1">
            <span className={labelText}>Lesson</span>
            <input
              type="text"
              value={draft.rubric.lesson ?? ""}
              onChange={(e) => update({ rubric: { ...draft.rubric, lesson: e.target.value || undefined } })}
              className={field}
            />
          </label>
        </div>
        <label className="flex items-start gap-2 text-sm text-da-text">
          <input
            type="checkbox"
            checked={showInGradebook}
            onChange={(e) => setShowInGradebook(e.target.checked)}
            className="mt-1"
          />
          <span>
            Show this in the gradebook
            <span className={`block ${hint}`}>
              Off by default. An activity is reported as Got it / Almost / Not yet per learning target on
              its own page; the marks behind that are plumbing, not a grade. Tick this only if you want a
              column for it in the grid. Either way it stays hidden from students and asks for no
              self-assessment.
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

      {/* ---- Parts ------------------------------------------------------ */}
      <section className="space-y-3 rounded-xl border border-da-border bg-da-surface p-5 shadow-sm">
        <div className="flex items-baseline justify-between gap-3">
          <h2 className="font-bold text-da-text">Parts and answers</h2>
          <span className={hint}>
            {draft.items.length} part{draft.items.length === 1 ? "" : "s"} · {totalMarks} marks
          </span>
        </div>
        <p className={hint}>
          A worksheet prints no marks, so Clev assigned them: <strong>2</strong> where a part holds two
          separable ideas, <strong>1</strong> where it holds one. That is what becomes Got it / Almost /
          Not yet. There is no printed total to check the read against, so this list is worth a careful
          look — click a part to read and edit its question and answer.
        </p>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-da-border text-left text-xs text-da-muted">
                <th className="pb-2 pr-2 font-semibold">Q</th>
                <th className="pb-2 pr-2 font-semibold">Part</th>
                <th className="pb-2 pr-2 font-semibold">Marks</th>
                <th className="pb-2 pr-2 font-semibold">Answer</th>
                <th className="pb-2" />
              </tr>
            </thead>
            <tbody>
              {draft.items.map((it, i) => (
                <tr key={i} className="border-b border-da-border/50 align-top">
                  <td className="py-2 pr-2">
                    <input
                      type="number"
                      min={1}
                      value={it.questionNumber}
                      onChange={(e) => updateItem(i, { questionNumber: Number(e.target.value) || 1 })}
                      className={`${small} w-16`}
                    />
                  </td>
                  <td className="py-2 pr-2">
                    <input
                      type="text"
                      value={it.partLabel}
                      onChange={(e) => updateItem(i, { partLabel: e.target.value.trim().toLowerCase() })}
                      className={`${small} w-16`}
                    />
                  </td>
                  <td className="py-2 pr-2">
                    <input
                      type="number"
                      min={1}
                      max={MAX_MARKS_PER_PART}
                      value={it.maxMarks}
                      onChange={(e) => updateItem(i, { maxMarks: Number(e.target.value) || 1 })}
                      className={`${small} w-16`}
                    />
                  </td>
                  <td className="py-2 pr-2">
                    <button
                      type="button"
                      onClick={() => setOpenItem(openItem === i ? null : i)}
                      className="text-left text-da-text hover:underline"
                    >
                      {it.markschemeText.slice(0, 90) || <span className="text-red-300">no answer read</span>}
                      {it.markschemeText.length > 90 ? "…" : ""}
                    </button>
                    {openItem === i && (
                      <div className="mt-2 space-y-2">
                        <label className="flex flex-col gap-1">
                          <span className={labelText}>Question</span>
                          <textarea
                            rows={4}
                            value={it.questionText}
                            onChange={(e) => updateItem(i, { questionText: e.target.value })}
                            className={field}
                          />
                        </label>
                        <label className="flex flex-col gap-1">
                          <span className={labelText}>What having the idea looks like</span>
                          <textarea
                            rows={5}
                            value={it.markschemeText}
                            onChange={(e) => updateItem(i, { markschemeText: e.target.value })}
                            className={field}
                          />
                          <span className={hint}>
                            The marker grades against this. Check the answer, the equivalent forms it says
                            to accept, and — on a 2-mark part — what each of the two marks is for.
                          </span>
                        </label>
                      </div>
                    )}
                  </td>
                  <td className="py-2 text-right">
                    <button type="button" onClick={() => removeItem(i)} className="text-xs text-red-300 hover:underline">
                      Remove
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <button type="button" onClick={addItem} className="text-sm text-purple-300 hover:underline">
          + Add part
        </button>
      </section>

      {/* ---- Learning targets ------------------------------------------- */}
      <section className="space-y-3 rounded-xl border border-da-border bg-da-surface p-5 shadow-sm">
        <h2 className="font-bold text-da-text">Learning targets</h2>
        <p className={hint}>
          What the report says Got it / Almost / Not yet about. A part may be evidence of more than one
          target — list it under each. Parts are written like <code>2d</code>, or <code>5</code> for a
          question with no parts, separated by commas.
        </p>
        {!draft.targetsFromLesson && (
          <p className="rounded-lg border border-amber-400/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">
            The lesson printed no targets, so Clev proposed these from the mathematics. Check they are the
            ones you are teaching.
          </p>
        )}
        <div className="space-y-4">
          {draft.rubric.targets.map((t, i) => {
            const partsMax = t.parts.reduce((s, ref) => {
              const item = draft.items.find(
                (it) => `${it.questionNumber}${it.partLabel}`.toLowerCase() === ref.toLowerCase()
              );
              return s + (item?.maxMarks ?? 0);
            }, 0);
            return (
              <div key={i} className="space-y-2 rounded-lg border border-da-border/60 p-3">
                <div className="grid gap-2 sm:grid-cols-[6rem_1fr_auto]">
                  <input
                    type="text"
                    value={t.code}
                    onChange={(e) => updateTarget(i, { code: normaliseTargetCode(e.target.value) })}
                    className={small}
                    aria-label="Target code"
                  />
                  <input
                    type="text"
                    value={t.name}
                    onChange={(e) => updateTarget(i, { name: e.target.value })}
                    placeholder="Look for relationships between variables"
                    className={small}
                    aria-label="Target name"
                  />
                  <button type="button" onClick={() => removeTarget(i)} className="text-xs text-red-300 hover:underline">
                    Remove
                  </button>
                </div>
                <input
                  type="text"
                  value={t.note ?? ""}
                  onChange={(e) => updateTarget(i, { note: e.target.value || undefined })}
                  placeholder="The QuickNotes line under the target, if there is one"
                  className={`${small} w-full`}
                  aria-label="Target note"
                />
                <label className="flex flex-col gap-1">
                  <span className={labelText}>
                    Parts ({partsMax} mark{partsMax === 1 ? "" : "s"} of evidence)
                  </span>
                  <input
                    type="text"
                    value={t.parts.join(", ")}
                    onChange={(e) =>
                      updateTarget(i, {
                        parts: e.target.value
                          .split(",")
                          .map((p) => p.trim().toLowerCase().replace(/[()\s.]/g, ""))
                          .filter(Boolean),
                      })
                    }
                    className={`${small} w-full`}
                  />
                  <span className={hint}>
                    {t.parts.length > 0 ? t.parts.map((p) => partRefLabel(p)).join(", ") : "No parts yet."}
                  </span>
                </label>
              </div>
            );
          })}
        </div>
        <button type="button" onClick={addTarget} className="text-sm text-purple-300 hover:underline">
          + Add learning target
        </button>
      </section>

      {/* ---- Findings and save ------------------------------------------ */}
      <section className="space-y-3 rounded-xl border border-da-border bg-da-surface p-5 shadow-sm">
        {allFindings.length > 0 ? (
          <ul className="space-y-1 text-sm">
            {allFindings.map((f, i) => (
              <li key={i} className={f.severity === "block" ? "text-red-300" : "text-amber-300"}>
                {f.severity === "block" ? "Blocks saving: " : "Check: "}
                {f.message}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-green-300">Nothing structural to flag. The transcription is still worth your eye.</p>
        )}
        {error && <p className="text-sm text-red-300">{error}</p>}
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={save}
            disabled={blocked || phase === "saving" || !courseId}
            className="rounded-lg bg-green-600 px-4 py-2 text-sm font-bold text-white hover:bg-green-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {phase === "saving" ? "Saving…" : "Save as an activity"}
          </button>
          <span className={hint}>
            {blocked ? "Fix the blocking problems above first." : "Creates a new activity; nothing is overwritten."}
          </span>
        </div>
      </section>
    </div>
  );
}
