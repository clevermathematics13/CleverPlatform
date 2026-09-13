"use client";

/**
 * The practice-set builder.
 *
 * Every mutation goes to /api/practice-sets/... and then router.refresh(), so
 * the server page stays the single source of what is on screen. There is no
 * local mirror of the set to drift out of date, which matters here because
 * approval state is a safety property: a stale "approved" badge would be a
 * lie about what a class can see.
 */

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import LatexRenderer from "@/components/LatexRenderer";
import { TIER_LABEL, TIER_ORDER, type PracticeTier } from "@/lib/practice-sets";
import type { AdminItem, AdminSet } from "@/lib/practice-set-admin";

interface Course {
  id: string;
  name: string;
}

export function PracticeSetsClient({ courses, sets }: { courses: Course[]; sets: AdminSet[] }) {
  const router = useRouter();
  const [selectedId, setSelectedId] = useState<string | null>(sets[0]?.id ?? null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  const selected = sets.find((s) => s.id === selectedId) ?? sets[0] ?? null;

  /** One place for every call, so failures surface the same way everywhere. */
  async function send(
    label: string,
    url: string,
    init: RequestInit
  ): Promise<Record<string, unknown> | null> {
    setBusy(label);
    setError(null);
    try {
      const res = await fetch(url, {
        ...init,
        headers: { "Content-Type": "application/json", ...(init.headers ?? {}) },
      });
      const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      if (!res.ok) {
        setError(typeof data.error === "string" ? data.error : `${label} failed (${res.status})`);
        return null;
      }
      startTransition(() => router.refresh());
      return data;
    } catch (e) {
      setError(e instanceof Error ? e.message : `${label} failed`);
      return null;
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="mx-auto max-w-6xl">
      <header className="mb-8">
        <h1 className="font-serif text-3xl font-bold text-da-text">Practice Sets</h1>
        <p className="mt-2 max-w-2xl text-sm text-da-muted">
          Questions a class works through outside a test. Nothing here reaches the gradebook, and a
          past paper you have a question <em>written from</em> stays unused, so you can still set it
          as an assessment.
        </p>
      </header>

      {error && (
        <p className="mb-6 rounded-lg border border-da-danger/50 bg-da-danger/10 px-4 py-3 text-sm text-da-text">
          {error}
        </p>
      )}

      <div className="grid gap-8 lg:grid-cols-[18rem_1fr]">
        <SetList
          sets={sets}
          courses={courses}
          selectedId={selected?.id ?? null}
          onSelect={setSelectedId}
          busy={busy}
          send={send}
        />
        {selected ? (
          <SetDetail set={selected} busy={busy} send={send} />
        ) : (
          <p className="rounded-xl border border-da-border bg-da-surface p-8 text-center text-sm text-da-muted">
            No practice sets yet. Create one to begin.
          </p>
        )}
      </div>
    </div>
  );
}

type Send = (
  label: string,
  url: string,
  init: RequestInit
) => Promise<Record<string, unknown> | null>;

function SetList({
  sets,
  courses,
  selectedId,
  onSelect,
  busy,
  send,
}: {
  sets: AdminSet[];
  courses: Course[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  busy: string | null;
  send: Send;
}) {
  const [name, setName] = useState("");
  const [courseId, setCourseId] = useState(courses[0]?.id ?? "");

  return (
    <aside className="space-y-4">
      <ul className="space-y-2">
        {sets.map((set) => (
          <li key={set.id}>
            <button
              type="button"
              onClick={() => onSelect(set.id)}
              className={`w-full rounded-lg border px-3 py-2 text-left transition-colors ${
                set.id === selectedId
                  ? "border-da-accent bg-da-accent/10"
                  : "border-da-border bg-da-surface hover:border-da-accent/50"
              }`}
            >
              <span className="block text-sm font-medium text-da-text">{set.name}</span>
              <span className="mt-0.5 block font-mono text-[11px] text-da-muted">
                {set.courseName} &middot; {set.items.length}Q &middot; {set.totalMarks} marks
              </span>
              <span className="mt-1 flex flex-wrap gap-1">
                <Badge tone={set.releasedAt ? "good" : "muted"}>
                  {set.releasedAt ? "released" : "draft"}
                </Badge>
                {set.awaitingApproval > 0 && (
                  <Badge tone="warn">{set.awaitingApproval} to approve</Badge>
                )}
              </span>
            </button>
          </li>
        ))}
      </ul>

      <form
        className="space-y-2 rounded-lg border border-da-border bg-da-surface p-3"
        onSubmit={async (e) => {
          e.preventDefault();
          if (!name.trim() || !courseId) return;
          const created = await send("Create", "/api/practice-sets", {
            method: "POST",
            body: JSON.stringify({ courseId, name }),
          });
          if (created?.id) {
            setName("");
            onSelect(created.id as string);
          }
        }}
      >
        <p className="font-mono text-[11px] uppercase tracking-wider text-da-muted">New set</p>
        <input
          id="new-set-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Integration Practice Set"
          className="w-full rounded border border-da-border bg-da-bg px-2 py-1.5 text-sm text-da-text placeholder:text-da-muted/60"
        />
        <select
          id="new-set-course"
          value={courseId}
          onChange={(e) => setCourseId(e.target.value)}
          className="w-full rounded border border-da-border bg-da-bg px-2 py-1.5 text-sm text-da-text"
        >
          {courses.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
        <button
          type="submit"
          disabled={busy !== null || !name.trim()}
          className="w-full rounded bg-da-accent px-3 py-1.5 text-sm font-medium text-da-on-accent disabled:opacity-40"
        >
          {busy === "Create" ? "Creating…" : "Create"}
        </button>
      </form>
    </aside>
  );
}

function SetDetail({ set, busy, send }: { set: AdminSet; busy: string | null; send: Send }) {
  return (
    <section className="space-y-6">
      <div className="rounded-xl border border-da-border bg-da-surface p-5">
        <div className="flex flex-wrap items-baseline justify-between gap-3">
          <div>
            <h2 className="font-serif text-2xl font-bold text-da-text">{set.name}</h2>
            <p className="mt-1 font-mono text-xs text-da-muted">
              {set.courseName} &middot; {set.items.length} questions &middot; {set.totalMarks} marks
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            {/* Only once a set is released: before that nobody has answered
                it, so a marking screen would open on an empty roster and
                read as broken rather than as early. */}
            {set.releasedAt && (
              <Link
                href={`/dashboard/practice-sets/${set.id}/marking`}
                className="rounded-md border border-da-border px-3 py-1.5 text-xs text-da-muted transition-colors hover:border-da-accent/60 hover:text-da-text"
              >
                Mark answers &rarr;
              </Link>
            )}
            <Toggle
              on={set.releasedAt !== null}
              label={set.releasedAt ? "Released to students" : "Not released"}
              busy={busy === "Release"}
              onClick={() =>
                send("Release", `/api/practice-sets/${set.id}`, {
                  method: "PATCH",
                  body: JSON.stringify({ released: set.releasedAt === null }),
                })
              }
            />
            <Toggle
              on={set.markschemeReleasedAt !== null}
              label={set.markschemeReleasedAt ? "Answers released" : "Answers withheld"}
              busy={busy === "Answers"}
              onClick={() =>
                send("Answers", `/api/practice-sets/${set.id}`, {
                  method: "PATCH",
                  body: JSON.stringify({ markschemeReleased: set.markschemeReleasedAt === null }),
                })
              }
            />
          </div>
        </div>
        {set.awaitingApproval > 0 && (
          <p className="mt-4 rounded border border-da-warning/40 bg-da-warning/10 px-3 py-2 text-sm text-da-text">
            {set.awaitingApproval} written question{set.awaitingApproval === 1 ? "" : "s"} still
            need reading. Students cannot see {set.awaitingApproval === 1 ? "it" : "them"} until you
            approve.
          </p>
        )}
      </div>

      <AddQuestion setId={set.id} busy={busy} send={send} />

      <ol className="space-y-4">
        {set.items.map((item) => (
          <ItemCard key={item.id} setId={set.id} item={item} busy={busy} send={send} />
        ))}
      </ol>
    </section>
  );
}

function AddQuestion({ setId, busy, send }: { setId: string; busy: string | null; send: Send }) {
  const [code, setCode] = useState("");
  const [tier, setTier] = useState<PracticeTier>("medium");

  const add = (mode: "bank" | "generate") =>
    send(mode === "bank" ? "Add" : "Write", `/api/practice-sets/${setId}/items`, {
      method: "POST",
      body: JSON.stringify({ mode, code: code.trim(), tier }),
    }).then((r) => {
      if (r) setCode("");
    });

  return (
    <div className="rounded-xl border border-da-border bg-da-surface p-5">
      <p className="font-mono text-[11px] uppercase tracking-wider text-da-muted">Add a question</p>
      <div className="mt-3 flex flex-wrap items-end gap-3">
        <label className="flex-1 min-w-[14rem]">
          <span className="mb-1 block text-xs text-da-muted">Past paper code</span>
          <input
            id="add-question-code"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            placeholder="22M.1.AHL.TZ1.H_1"
            className="w-full rounded border border-da-border bg-da-bg px-2 py-1.5 font-mono text-sm text-da-text placeholder:text-da-muted/60"
          />
        </label>
        <label>
          <span className="mb-1 block text-xs text-da-muted">Tier</span>
          <select
            id="add-question-tier"
            value={tier}
            onChange={(e) => setTier(e.target.value as PracticeTier)}
            className="rounded border border-da-border bg-da-bg px-2 py-1.5 text-sm text-da-text"
          >
            {TIER_ORDER.map((t) => (
              <option key={t} value={t}>
                {TIER_LABEL[t]}
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          disabled={busy !== null || !code.trim()}
          onClick={() => add("generate")}
          className="rounded bg-da-accent px-3 py-1.5 text-sm font-medium text-da-on-accent disabled:opacity-40"
        >
          {busy === "Write" ? "Writing…" : "Write a new question from it"}
        </button>
        <button
          type="button"
          disabled={busy !== null || !code.trim()}
          onClick={() => add("bank")}
          className="rounded border border-da-border px-3 py-1.5 text-sm text-da-text hover:border-da-accent/60 disabled:opacity-40"
        >
          {busy === "Add" ? "Adding…" : "Use the past paper as it is"}
        </button>
      </div>
      <p className="mt-3 max-w-2xl text-xs text-da-muted">
        Writing a new one keeps the past paper unused, so it is still available to set as an
        assessment. It takes a minute or so, and arrives as a draft for you to read.
      </p>
    </div>
  );
}

function ItemCard({
  setId,
  item,
  busy,
  send,
}: {
  setId: string;
  item: AdminItem;
  busy: string | null;
  send: Send;
}) {
  const [showAnswer, setShowAnswer] = useState(false);
  const label = `item-${item.id}`;

  return (
    <li className="rounded-xl border border-da-border bg-da-surface p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <div className="flex flex-wrap items-baseline gap-2">
          <span className="font-serif text-lg font-bold text-da-accent">{item.position}.</span>
          <span className="text-sm text-da-text">{item.subtopicLabels.join(" · ") || "untagged"}</span>
          <Badge tone="muted">{TIER_LABEL[item.tier]}</Badge>
          {item.source === "generated" ? (
            <Badge tone={item.approvedAt ? "good" : "warn"}>
              {item.approvedAt ? "written · approved" : "written · draft"}
            </Badge>
          ) : (
            <Badge tone="muted">past paper</Badge>
          )}
        </div>
        <span className="font-mono text-sm font-semibold text-da-muted">[{item.marks}]</span>
      </div>

      <p className="mt-1 font-mono text-[11px] text-da-muted/70">
        {item.source === "bank"
          ? item.ibQuestionCode
          : `modelled on ${item.generatedFromCode ?? "?"}${
              item.generatorModel ? ` · ${item.generatorModel}` : ""
            }`}
      </p>

      {item.questionLatex && (
        <div className="mt-3 rounded-lg bg-da-bg/60 px-4 py-3 text-da-text">
          <LatexRenderer latex={item.questionLatex} />
        </div>
      )}

      {item.teacherNote && (
        <p className="mt-3 whitespace-pre-line rounded border border-da-border/60 bg-da-bg/40 px-3 py-2 text-xs leading-relaxed text-da-muted">
          {item.teacherNote}
        </p>
      )}

      {item.answerLatex && (
        <div className="mt-3">
          <button
            type="button"
            id={`${label}-answer-toggle`}
            onClick={() => setShowAnswer((v) => !v)}
            className="font-mono text-[11px] uppercase tracking-wider text-da-muted hover:text-da-text"
          >
            {showAnswer ? "Hide mark scheme" : "Show mark scheme"}
          </button>
          {/* Teacher-only, whatever the set's answer gate says: this whole
              page is behind requireTeacher, and the student service does not
              select answer_latex at all. */}
          <div hidden={!showAnswer} className="mt-2 rounded-lg bg-da-bg/60 px-4 py-3 text-da-text">
            <LatexRenderer latex={item.answerLatex} />
          </div>
        </div>
      )}

      <div className="mt-4 flex flex-wrap gap-2">
        {item.source === "generated" && (
          <button
            type="button"
            disabled={busy !== null}
            onClick={() =>
              send("Approve", `/api/practice-sets/${setId}/items/${item.id}`, {
                method: "PATCH",
                body: JSON.stringify({ approved: !item.approvedAt }),
              })
            }
            className={
              item.approvedAt
                ? "rounded border border-da-border px-3 py-1.5 text-xs text-da-muted hover:text-da-text disabled:opacity-40"
                : "rounded bg-da-success px-3 py-1.5 text-xs font-medium text-da-on-accent disabled:opacity-40"
            }
          >
            {item.approvedAt ? "Withdraw approval" : "Approve for students"}
          </button>
        )}
        <button
          type="button"
          disabled={busy !== null}
          onClick={() =>
            send("Remove", `/api/practice-sets/${setId}/items/${item.id}`, { method: "DELETE" })
          }
          className="rounded border border-da-border px-3 py-1.5 text-xs text-da-muted hover:border-da-danger/60 hover:text-da-text disabled:opacity-40"
        >
          Remove
        </button>
      </div>
    </li>
  );
}

function Badge({ children, tone }: { children: React.ReactNode; tone: "good" | "warn" | "muted" }) {
  const toneClass =
    tone === "good"
      ? "border-da-success/50 text-da-success"
      : tone === "warn"
        ? "border-da-warning/50 text-da-warning"
        : "border-da-border text-da-muted";
  return (
    <span className={`rounded-full border px-2 py-0.5 font-mono text-[10px] ${toneClass}`}>
      {children}
    </span>
  );
}

function Toggle({
  on,
  label,
  busy,
  onClick,
}: {
  on: boolean;
  label: string;
  busy: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={busy}
      aria-pressed={on}
      className={`rounded-full border px-3 py-1 text-xs transition-colors disabled:opacity-40 ${
        on
          ? "border-da-success/60 bg-da-success/10 text-da-success"
          : "border-da-border text-da-muted hover:text-da-text"
      }`}
    >
      {busy ? "…" : label}
    </button>
  );
}
