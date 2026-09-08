"use client";

import { useMemo, useState } from "react";
import { abbreviateAssessmentName, assessmentShortName } from "@/lib/assessment-short-name";

export type BoundarySetOption = {
  id: string;
  name: string;
  description: string | null;
  /** Grade 7 down to 1, each with the percentage it starts at. */
  bands: { grade: number; minPct: number }[];
};

export type TestDetail = {
  id: string;
  name: string;
  short_name: string | null;
  test_date: string | null;
  exam_time: string | null;
  release_at: string | null;
  total_marks: number | null;
  course_id: string | null;
  hidden: boolean;
  hidden_from_gradebook: boolean;
  require_self_assessment: boolean;
  boundary_set_id: string | null;
  paper_url: string | null;
  mark_scheme_url: string | null;
  courses: { name: string } | null;
  test_items: {
    id: string;
    question_number: number;
    part_label: string;
    max_marks: number;
    sort_order: number | null;
    ib_question_code: string | null;
    subtopic_codes: string[] | null;
  }[];
};

/** What the form holds. Every value is a string, the way an input gives it. */
type Draft = {
  name: string;
  course_id: string;
  test_date: string;
  exam_time: string;
  release_at: string;
  total_marks: string;
  short_name: string;
  boundary_set_id: string;
  paper_url: string;
  mark_scheme_url: string;
  hidden: boolean;
  hidden_from_gradebook: boolean;
  require_self_assessment: boolean;
};

/**
 * A stored timestamp as `datetime-local` wants it: the teacher's own clock,
 * not UTC. Slicing an ISO string instead would show a Lima 2pm release as 7pm.
 */
function toLocalInput(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(
    d.getHours()
  )}:${pad(d.getMinutes())}`;
}

/** The inverse. A bare `datetime-local` value means local time. */
function fromLocalInput(value: string): string | null {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/** `HH:MM:SS` from the database, `HH:MM` for the input. */
function toTimeInput(value: string | null): string {
  return value ? value.slice(0, 5) : "";
}

function draftFrom(test: TestDetail): Draft {
  return {
    name: test.name ?? "",
    course_id: test.course_id ?? "",
    test_date: test.test_date ?? "",
    exam_time: toTimeInput(test.exam_time),
    release_at: toLocalInput(test.release_at),
    total_marks: test.total_marks == null ? "" : String(test.total_marks),
    short_name: test.short_name ?? "",
    boundary_set_id: test.boundary_set_id ?? "",
    paper_url: test.paper_url ?? "",
    mark_scheme_url: test.mark_scheme_url ?? "",
    hidden: test.hidden,
    hidden_from_gradebook: test.hidden_from_gradebook,
    require_self_assessment: test.require_self_assessment,
  };
}

const field =
  "w-full rounded-lg border border-da-border bg-da-bg px-3 py-2 text-sm text-da-text focus:border-da-accent focus:outline-none disabled:opacity-50";
const labelText = "text-xs font-semibold uppercase tracking-wide text-da-muted";
const hint = "text-xs text-da-muted";

export function TestDetailClient({
  test,
  courses,
  boundarySets,
}: {
  test: TestDetail;
  courses: { id: string; name: string }[];
  boundarySets: BoundarySetOption[];
}) {
  const [saved, setSaved] = useState<TestDetail>(test);
  const [draft, setDraft] = useState<Draft>(() => draftFrom(test));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [justSaved, setJustSaved] = useState(false);

  const set = <K extends keyof Draft>(key: K, value: Draft[K]) => {
    setDraft((d) => ({ ...d, [key]: value }));
    setJustSaved(false);
  };

  const dirty = useMemo(() => {
    const original = draftFrom(saved);
    return (Object.keys(original) as (keyof Draft)[]).some((k) => original[k] !== draft[k]);
  }, [draft, saved]);

  const items = useMemo(
    () =>
      [...saved.test_items].sort(
        (a, b) => (a.sort_order ?? a.question_number) - (b.sort_order ?? b.question_number)
      ),
    [saved.test_items]
  );
  const itemsTotal = items.reduce((sum, it) => sum + it.max_marks, 0);

  const chosenSet = boundarySets.find((s) => s.id === draft.boundary_set_id) ?? null;

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/tests/${saved.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: draft.name.trim(),
          course_id: draft.course_id || null,
          test_date: draft.test_date || null,
          exam_time: draft.exam_time || null,
          release_at: fromLocalInput(draft.release_at),
          total_marks: draft.total_marks === "" ? null : Number(draft.total_marks),
          short_name: draft.short_name,
          boundary_set_id: draft.boundary_set_id || null,
          paper_url: draft.paper_url,
          mark_scheme_url: draft.mark_scheme_url,
          hidden: draft.hidden,
          hidden_from_gradebook: draft.hidden_from_gradebook,
          require_self_assessment: draft.require_self_assessment,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data?.error ?? res.statusText);
        return;
      }
      // Keep the course name and the questions, which the PATCH response does
      // not carry -- only the row's own columns come back.
      setSaved((prev) => ({
        ...prev,
        ...data,
        courses: courses.find((c) => c.id === data.course_id)
          ? { name: courses.find((c) => c.id === data.course_id)!.name }
          : prev.courses,
      }));
      setJustSaved(true);
    } catch {
      setError("Could not save: network error.");
    } finally {
      setSaving(false);
    }
  };

  const exampleFilename = `${saved.courses?.name ?? "9C"}_${
    assessmentShortName({ name: draft.name, short_name: draft.short_name || null }) || "Form1"
  }_6.csv`;

  return (
    <div className="mx-auto max-w-4xl space-y-6 p-6">
      <div>
        <a href="/dashboard/tests" className="text-sm text-blue-300 hover:underline">
          ← Back to tests
        </a>
        <p className="mt-2 text-xs font-medium uppercase tracking-widest text-da-muted">
          Assessment
        </p>
        <h1 className="font-serif text-3xl font-bold text-da-text">{saved.name}</h1>
        <p className={`mt-1 ${hint}`}>
          {saved.courses?.name ?? "No class"} · {items.length} question
          {items.length === 1 ? "" : "s"} · {itemsTotal} marks
        </p>
      </div>

      <div className="flex flex-wrap gap-2">
        <a
          href={`/dashboard/reflection?testId=${saved.id}`}
          className="rounded border border-blue-400/40 bg-blue-500/15 px-3 py-1.5 text-xs text-blue-300 hover:bg-blue-500/25"
        >
          Enter Marks →
        </a>
        <a
          href={`/dashboard/tests/${saved.id}/ai-grade`}
          className="rounded border border-purple-400/40 bg-purple-500/15 px-3 py-1.5 text-xs text-purple-300 hover:bg-purple-500/25"
        >
          Mark Scans →
        </a>
        <a
          href={`/dashboard/tests/${saved.id}/paper-layout`}
          className="rounded border border-da-border px-3 py-1.5 text-xs text-da-muted hover:bg-da-hover"
        >
          Paper layout →
        </a>
      </div>

      {/* -- Details ------------------------------------------------------ */}
      <section className="space-y-4 rounded-xl border border-da-border bg-da-surface p-5 shadow-sm">
        <h2 className="font-bold text-da-text">Details</h2>

        <label className="flex flex-col gap-1">
          <span className={labelText}>Name</span>
          <input
            type="text"
            value={draft.name}
            onChange={(e) => set("name", e.target.value)}
            className={field}
          />
        </label>

        <div className="grid gap-4 sm:grid-cols-2">
          <label className="flex flex-col gap-1">
            <span className={labelText}>Class</span>
            <select
              value={draft.course_id}
              onChange={(e) => set("course_id", e.target.value)}
              className={field}
            >
              <option value="">— none —</option>
              {courses.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>

          <label className="flex flex-col gap-1">
            <span className={labelText}>Total marks</span>
            <input
              type="number"
              min={0}
              value={draft.total_marks}
              onChange={(e) => set("total_marks", e.target.value)}
              className={field}
            />
            <span className={hint}>
              {itemsTotal > 0 && Number(draft.total_marks) !== itemsTotal
                ? `The questions below add up to ${itemsTotal}.`
                : "Used where a paper has no question breakdown."}
            </span>
          </label>

          <label className="flex flex-col gap-1">
            <span className={labelText}>Date</span>
            <input
              type="date"
              value={draft.test_date}
              onChange={(e) => set("test_date", e.target.value)}
              className={field}
            />
          </label>

          <label className="flex flex-col gap-1">
            <span className={labelText}>Start time</span>
            <input
              type="time"
              value={draft.exam_time}
              onChange={(e) => set("exam_time", e.target.value)}
              className={field}
            />
          </label>
        </div>

        <label className="flex flex-col gap-1">
          <span className={labelText}>Marks released at</span>
          <input
            type="datetime-local"
            value={draft.release_at}
            onChange={(e) => set("release_at", e.target.value)}
            className={field}
          />
          <span className={hint}>
            Your local time. Set 80 minutes after the start when the test is created;
            students see nothing before it.
          </span>
        </label>
      </section>

      {/* -- Grading ------------------------------------------------------ */}
      <section className="space-y-4 rounded-xl border border-da-border bg-da-surface p-5 shadow-sm">
        <h2 className="font-bold text-da-text">Grading</h2>

        <label className="flex flex-col gap-1">
          <span className={labelText}>Boundary set</span>
          <select
            value={draft.boundary_set_id}
            onChange={(e) => set("boundary_set_id", e.target.value)}
            className={field}
          >
            <option value="">— unassigned (approximate grades) —</option>
            {boundarySets.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
                {s.description ? ` — ${s.description}` : ""}
              </option>
            ))}
          </select>
          {chosenSet ? (
            <span className={hint}>
              {chosenSet.bands.length > 0
                ? chosenSet.bands.map((b) => `${b.grade} from ${b.minPct}%`).join(" · ")
                : "This set has no bands recorded."}
            </span>
          ) : (
            <span className={hint}>
              Without a set the gradebook falls back to fixed thresholds and marks every
              level as approximate — the <span className="font-mono">~</span> beside the
              column.
            </span>
          )}
        </label>

        <label className="flex flex-col gap-1">
          <span className={labelText}>Short name for exports</span>
          <input
            type="text"
            value={draft.short_name}
            maxLength={24}
            placeholder={abbreviateAssessmentName(draft.name) || "Form1"}
            onChange={(e) => set("short_name", e.target.value)}
            className={`${field} sm:max-w-40`}
          />
          <span className={hint}>
            Names the PowerSchool file written when a student finishes the
            self-assessment: <span className="font-mono">{exampleFilename}</span>. Left
            blank, it is abbreviated from the assessment name.
          </span>
        </label>
      </section>

      {/* -- Visibility --------------------------------------------------- */}
      <section className="space-y-3 rounded-xl border border-da-border bg-da-surface p-5 shadow-sm">
        <h2 className="font-bold text-da-text">Visibility</h2>

        <label className="flex items-start gap-2 text-sm text-da-text">
          <input
            type="checkbox"
            checked={draft.hidden}
            onChange={(e) => set("hidden", e.target.checked)}
            className="mt-1"
          />
          <span>
            Hide from students
            <span className={`block ${hint}`}>
              Keeps it out of the student reflection dropdown. Says nothing about your
              own gradebook.
            </span>
          </span>
        </label>

        <label className="flex items-start gap-2 text-sm text-da-text">
          <input
            type="checkbox"
            checked={draft.hidden_from_gradebook}
            onChange={(e) => set("hidden_from_gradebook", e.target.checked)}
            className="mt-1"
          />
          <span>
            Hide from my gradebook
            <span className={`block ${hint}`}>
              Drops the column from the grid. Marks, levels and the PowerSchool export
              carry on unchanged.
            </span>
          </span>
        </label>

        <label className="flex items-start gap-2 text-sm text-da-text">
          <input
            type="checkbox"
            checked={draft.require_self_assessment}
            onChange={(e) => set("require_self_assessment", e.target.checked)}
            className="mt-1"
          />
          <span>
            Require self-assessment before releasing Clev&apos;s Marks
            <span className={`block ${hint}`}>
              When off, a student sees their marks without submitting a self-assessment
              first.
            </span>
          </span>
        </label>
      </section>

      {/* -- Files -------------------------------------------------------- */}
      <section className="space-y-4 rounded-xl border border-da-border bg-da-surface p-5 shadow-sm">
        <h2 className="font-bold text-da-text">Files</h2>
        <label className="flex flex-col gap-1">
          <span className={labelText}>Paper URL</span>
          <input
            type="url"
            value={draft.paper_url}
            onChange={(e) => set("paper_url", e.target.value)}
            placeholder="https://…"
            className={field}
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className={labelText}>Mark scheme URL</span>
          <input
            type="url"
            value={draft.mark_scheme_url}
            onChange={(e) => set("mark_scheme_url", e.target.value)}
            placeholder="https://…"
            className={field}
          />
        </label>
      </section>

      {/* -- Questions ---------------------------------------------------- */}
      <section className="space-y-3 rounded-xl border border-da-border bg-da-surface p-5 shadow-sm">
        <div className="flex items-baseline justify-between gap-3">
          <h2 className="font-bold text-da-text">Questions</h2>
          <span className={hint}>
            {items.length} part{items.length === 1 ? "" : "s"} · {itemsTotal} marks
          </span>
        </div>
        {items.length === 0 ? (
          <p className={hint}>No question breakdown recorded for this assessment.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-da-border text-left text-xs text-da-muted">
                  <th className="pb-2 font-semibold">Question</th>
                  <th className="pb-2 font-semibold">Max marks</th>
                  <th className="pb-2 font-semibold">Bank code</th>
                  <th className="pb-2 font-semibold">Subtopics</th>
                </tr>
              </thead>
              <tbody>
                {items.map((it) => (
                  <tr key={it.id} className="border-b border-da-border/50 last:border-0">
                    <td className="py-1.5 text-da-text">
                      Q{it.question_number}
                      {it.part_label}
                    </td>
                    <td className="py-1.5 text-da-muted">{it.max_marks}</td>
                    <td className="py-1.5 font-mono text-xs text-da-muted">
                      {it.ib_question_code ?? "—"}
                    </td>
                    <td className="py-1.5 text-xs text-da-muted">
                      {it.subtopic_codes?.length ? it.subtopic_codes.join(", ") : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {/* Not editable here on purpose: every student's marks hang off these
            rows by id, so changing a max mark silently rescales percentages
            and levels already recorded. That needs its own deliberate flow. */}
        <p className={hint}>
          Question parts are not editable here — students&apos; marks are recorded
          against them, so changing a max mark would rescale levels already given.
        </p>
      </section>

      {/* -- Save --------------------------------------------------------- */}
      <div className="sticky bottom-4 flex flex-wrap items-center gap-3 rounded-xl border border-da-border bg-da-surface/95 p-4 shadow-lg backdrop-blur">
        <button
          type="button"
          onClick={save}
          disabled={!dirty || saving}
          className={`rounded-lg px-4 py-2 text-sm font-bold transition-colors ${
            dirty && !saving
              ? "bg-blue-600 text-white hover:bg-blue-700"
              : "cursor-not-allowed bg-da-bg text-da-muted"
          }`}
        >
          {saving ? "Saving…" : "Save changes"}
        </button>
        {dirty && !saving && <span className={hint}>Unsaved changes.</span>}
        {justSaved && !dirty && (
          <span role="status" className="text-xs text-green-300">
            Saved.
          </span>
        )}
        {error && (
          <span role="status" className="text-xs text-red-300">
            {error}
          </span>
        )}
      </div>
    </div>
  );
}
