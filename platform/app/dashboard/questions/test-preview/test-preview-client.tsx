"use client";

import { useEffect, useState, useRef } from "react";
import QRCode from "qrcode";

// ─── Types ───────────────────────────────────────────────────────────────────

interface TestBuilderConfig {
  questionIds: string[];
  imageType: "question" | "markscheme";
  examName: string;
  curriculum: string;  // 'AA' | 'AI'
  level: string;       // 'HL' | 'SL'
  paper: number;       // 1 | 2 | 3
  courseId: string;
  date: string;        // ISO date string e.g. "2026-05-12"
  answerBoxMode?: "auto" | "fixed";
  answerBoxFixedMm?: number;
  questionAnswerBoxMm?: Record<string, number>;
}

interface QuestionPart {
  id: string;
  part_label: string;
  marks: number;
  subtopic_codes: string[];
  command_term: string | null;
  sort_order: number;
}

interface QuestionImage {
  id: string;
  sort_order: number;
  alt_text: string | null;
  url: string | null;
}

interface TestQuestion {
  id: string;
  code: string;
  section: "A" | "B" | null;
  curriculum: string[];
  parts: QuestionPart[];
  images: QuestionImage[];
}

interface Student {
  id: string;
  profiles: { display_name: string | null; nickname: string | null } | null;
}

interface NameField {
  x: number;
  y: number;
  w: number;
  h: number;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function formatDate(iso: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  return d.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

function studentDisplayName(s: Student): string {
  return s.profiles?.nickname ?? s.profiles?.display_name ?? "Student";
}

function questionTotalMarks(q: TestQuestion): number {
  return (q.parts ?? []).reduce((sum, part) => sum + (Number(part.marks) || 0), 0);
}

function ibdpDottedLineCount(q: TestQuestion): number {
  // Slightly fewer guide lines when question media is heavier.
  if ((q.images?.length ?? 0) >= 3) return 12;
  if ((q.images?.length ?? 0) === 2) return 14;
  return 16;
}

// IB answer lines are actual ". . . . ." dot text, not CSS borders (matches IB paper 2225-7106)
const IB_DOT_ROW =
  ". . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . .";

function renderIbdpDottedLines(keyPrefix: string, lineCount: number) {
  return Array.from({ length: lineCount }).map((_, lineIdx) => (
    <div
      key={`${keyPrefix}-${lineIdx}`}
      style={{
        fontFamily: '"Arial", sans-serif',
        fontSize: "8.5pt",
        color: "#444",
        overflow: "hidden",
        whiteSpace: "nowrap",
        lineHeight: "1",
        marginBottom: lineIdx < lineCount - 1 ? "3.8mm" : "0",
      }}
    >
      {IB_DOT_ROW}
    </div>
  ));
}

function renderCornerMark(position: "top-left" | "top-right" | "bottom-left" | "bottom-right") {
  const isLeft = position.includes("left");
  const isTop = position.includes("top");
  return (
    <div
      aria-hidden="true"
      style={{
        position: "absolute",
        [isLeft ? "left" : "right"]: "4mm",
        [isTop ? "top" : "bottom"]: "4mm",
        width: "6mm",
        height: "6mm",
        borderTop: isTop ? "1px solid #222" : undefined,
        borderBottom: !isTop ? "1px solid #222" : undefined,
        borderLeft: isLeft ? "1px solid #222" : undefined,
        borderRight: !isLeft ? "1px solid #222" : undefined,
      }}
    />
  );
}

function renderPageChrome(
  pageNumber: number,
  paperCode: string,
  opts?: { turnOver?: boolean }
) {
  // Page code used in barcode label, e.g. "16EP02" (IB format: index * 2 + page)
  const pageCode = `${String(pageNumber).padStart(2, "0")}EP${String(pageNumber * 2).padStart(2, "0")}`;
  return (
    <>
      {renderCornerMark("top-left")}
      {renderCornerMark("top-right")}
      {renderCornerMark("bottom-left")}
      {renderCornerMark("bottom-right")}

      {/* Right-edge perforated binding strip — matches IB booklet outer edge */}
      <div
        aria-hidden="true"
        style={{
          position: "absolute",
          top: "0",
          right: "0",
          width: "8mm",
          height: "100%",
          backgroundImage:
            "repeating-linear-gradient(to bottom, #555 0px, #555 1.5px, transparent 1.5px, transparent 3.5px, #555 3.5px, #555 5px, transparent 5px, transparent 8px)",
          backgroundSize: "8mm 8px",
          opacity: 0.45,
        }}
      />




    </>
  );
}

// ─── Module-level exam data cache (survives component re-mounts) ─────────────

interface ExamDataCache {
  key: string;
  questions: TestQuestion[];
  students: Student[];
  thumbnailUrl: string | null;
  nameField: NameField | null;
}

let _examCache: ExamDataCache | null = null;

function cacheKey(config: TestBuilderConfig): string {
  return JSON.stringify({
    questionIds: config.questionIds,
    imageType: config.imageType,
    courseId: config.courseId,
    curriculum: config.curriculum,
    level: config.level,
    paper: config.paper,
  });
}

// ─── QR generation (async per question per student) ──────────────────────────

async function makeQrDataUrl(
  examName: string,
  studentName: string,
  code: string
): Promise<string> {
  try {
    return await QRCode.toDataURL(
      JSON.stringify({ exam: examName, student: studentName, code }),
      { width: 80, margin: 1, errorCorrectionLevel: "M" }
    );
  } catch {
    return "";
  }
}

// ─── Component ───────────────────────────────────────────────────────────────

export function TestPreviewClient() {
  // Lazily read config from sessionStorage so it's available immediately on
  // remount without going through an async effect cycle.
  const [config, setConfig] = useState<TestBuilderConfig | null>(() => {
    try {
      const raw = sessionStorage.getItem("testBuilderConfig");
      return raw ? (JSON.parse(raw) as TestBuilderConfig) : null;
    } catch {
      return null;
    }
  });

  // Lazily initialise from the module-level cache so remounts are instant.
  const [questions, setQuestions] = useState<TestQuestion[]>(() => {
    try {
      const raw = sessionStorage.getItem("testBuilderConfig");
      if (!raw) return [];
      const cfg = JSON.parse(raw) as TestBuilderConfig;
      return _examCache?.key === cacheKey(cfg) ? _examCache.questions : [];
    } catch { return []; }
  });
  const [students, setStudents] = useState<Student[]>(() => {
    try {
      const raw = sessionStorage.getItem("testBuilderConfig");
      if (!raw) return [];
      const cfg = JSON.parse(raw) as TestBuilderConfig;
      return _examCache?.key === cacheKey(cfg) ? _examCache.students : [];
    } catch { return []; }
  });
  const [thumbnailUrl, setThumbnailUrl] = useState<string | null>(() => {
    try {
      const raw = sessionStorage.getItem("testBuilderConfig");
      if (!raw) return null;
      const cfg = JSON.parse(raw) as TestBuilderConfig;
      return _examCache?.key === cacheKey(cfg) ? _examCache.thumbnailUrl : null;
    } catch { return null; }
  });
  const [nameField, setNameField] = useState<NameField | null>(() => {
    try {
      const raw = sessionStorage.getItem("testBuilderConfig");
      if (!raw) return null;
      const cfg = JSON.parse(raw) as TestBuilderConfig;
      return _examCache?.key === cacheKey(cfg) ? _examCache.nameField : null;
    } catch { return null; }
  });
  const [qrCodes, setQrCodes] = useState<Record<string, Record<string, string>>>({});
  // Skip the loading screen entirely when the module-level cache already has
  // data for this config (i.e. the component is remounting, not fresh-loading).
  const [loading, setLoading] = useState<boolean>(() => {
    try {
      const raw = sessionStorage.getItem("testBuilderConfig");
      if (!raw || !_examCache) return true;
      const cfg = JSON.parse(raw) as TestBuilderConfig;
      return _examCache.key !== cacheKey(cfg);
    } catch { return true; }
  });
  const [error, setError] = useState<string | null>(null);
  const [printMode, setPrintMode] = useState<"general" | "batched">("general");
  const [tocEditors, setTocEditors] = useState<Set<string>>(new Set());
  const printTriggered = useRef(false);

  // ── Handle missing config ───────────────────────────────────────────────────
  useEffect(() => {
    if (!config) {
      setError("No exam configuration found. Please return to the question bank and build a test.");
      setLoading(false);
    }
  }, [config]);

  // ── Fetch data once config is loaded ───────────────────────────────────────
  useEffect(() => {
    if (!config) return;

    // If the module-level cache already has data for this config, use it
    // immediately without hitting the network (covers HMR / remount cases).
    const key = cacheKey(config);
    if (_examCache && _examCache.key === key) {
      setQuestions(_examCache.questions);
      setStudents(_examCache.students);
      setThumbnailUrl(_examCache.thumbnailUrl);
      setNameField(_examCache.nameField);
      setLoading(false);
      return;
    }

    async function fetchAll() {
      setLoading(true);
      setError(null);

      try {
        const [questionsRes, studentsRes, coverRes] = await Promise.all([
          fetch("/api/questions/test-images", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              questionIds: config!.questionIds,
              imageType: config!.imageType,
            }),
          }),
          fetch(`/api/students?courseId=${config!.courseId}`),
          fetch(
            `/api/exam-templates/cover?curriculum=${config!.curriculum}&level=${config!.level}&paper=${config!.paper}`
          ),
        ]);

        if (!questionsRes.ok) throw new Error("Failed to load question images");
        const { questions: qs } = await questionsRes.json();
        const resolvedStudents = studentsRes.ok ? ((await studentsRes.json()).students ?? []) : [];
        let resolvedThumbnail: string | null = null;
        let resolvedNameField: NameField | null = null;
        if (coverRes.ok) {
          const { thumbnailUrl: tu, nameField: nf } = await coverRes.json();
          resolvedThumbnail = tu ?? null;
          resolvedNameField = nf ?? null;
        }

        // Populate the module-level cache for future remounts.
        _examCache = {
          key,
          questions: qs ?? [],
          students: resolvedStudents,
          thumbnailUrl: resolvedThumbnail,
          nameField: resolvedNameField,
        };

        setQuestions(qs ?? []);
        setStudents(resolvedStudents);
        setThumbnailUrl(resolvedThumbnail);
        setNameField(resolvedNameField);
        // Cover not found = no cover page; we continue without one
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to load exam data");
      } finally {
        setLoading(false);
      }
    }

    fetchAll();
  }, [config]);

  // ── Generate QR codes once students + questions are ready ──────────────────
  useEffect(() => {
    if (!config || students.length === 0 || questions.length === 0) return;

    async function generateQrs() {
      const result: Record<string, Record<string, string>> = {};
      await Promise.all(
        students.map(async (s) => {
          const name = studentDisplayName(s);
          result[s.id] = {};
          await Promise.all(
            questions.map(async (q) => {
              result[s.id][q.code] = await makeQrDataUrl(
                config!.examName,
                name,
                q.code
              );
            })
          );
        })
      );
      setQrCodes(result);
    }

    generateQrs();
  }, [config, students, questions]);

  // ─── Derived values ────────────────────────────────────────────────────────

  const showSections =
    config && config.paper !== 3 && config.curriculum === "AA";

  // Separate section A and B (in queue order within each group)
  const sectionAQuestions = showSections
    ? questions.filter((q) => q.section === "A")
    : [];
  const sectionBQuestions = showSections
    ? questions.filter((q) => q.section === "B")
    : [];
  // For non-section exams or P3, all questions in order
  const orderedQuestions = showSections
    ? [...sectionAQuestions, ...sectionBQuestions]
    : questions;

  // ─── Render ────────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="bg-white text-gray-600" style={{ position: "fixed", inset: 0, overflowY: "auto", zIndex: 100 }}>
        <div className="text-center space-y-3">
          <div className="text-4xl">⏳</div>
          <p className="text-lg font-medium">Building exam preview…</p>
          <p className="text-sm text-gray-500">Fetching images and generating QR codes</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-white text-red-600" style={{ position: "fixed", inset: 0, overflowY: "auto", zIndex: 100 }}>
        <div className="text-center space-y-3 max-w-md">
          <div className="text-4xl">⚠️</div>
          <p className="text-lg font-medium">{error}</p>
          <button
            onClick={() => window.close()}
            className="mt-4 px-4 py-2 bg-gray-200 rounded hover:bg-gray-300 text-gray-700"
          >
            Close tab
          </button>
        </div>
      </div>
    );
  }

  const examLabel = `${config?.curriculum} ${config?.level} Paper ${config?.paper}`;
  const paperCode = `${config?.curriculum}${config?.level} P${config?.paper}`;

  return (
    <div className="preview-root" style={{ position: "fixed", inset: 0, zIndex: 100, overflow: "hidden", display: "flex", flexDirection: "column", background: "white", color: "#111827" }}>
      {/* ── Print controls (hidden in print) ── */}
      <div
        className="no-print"
        style={{ background: "white", borderBottom: "1px solid #e5e7eb", padding: "12px 24px", display: "flex", alignItems: "center", justifyContent: "space-between", boxShadow: "0 1px 2px rgba(0,0,0,0.05)", flexShrink: 0, printColorAdjust: "exact" }}
      >
        <div>
          <p className="font-semibold text-gray-800">{config?.examName}</p>
          <p className="text-sm text-gray-500">
            {examLabel} · {students.length} student{students.length !== 1 ? "s" : ""} ·{" "}
            {orderedQuestions.length} question{orderedQuestions.length !== 1 ? "s" : ""}
          </p>
        </div>
        <div className="flex gap-3">
          <button
            onClick={() => {
              document.body.classList.remove("print-batched");
              document.body.classList.add("print-general");
              window.print();
              document.body.classList.remove("print-general");
            }}
            className="px-5 py-2 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700 transition-colors"
          >
            🖨 Print General Exam
          </button>
          <button
            onClick={() => {
              document.body.classList.remove("print-general");
              document.body.classList.add("print-batched");
              window.print();
              window.addEventListener("afterprint", () => {
                document.body.classList.remove("print-batched");
                setPrintMode("general");
              }, { once: true });
              setPrintMode("batched");
            }}
            disabled={students.length === 0}
            className="px-5 py-2 bg-green-600 text-white rounded-lg font-medium hover:bg-green-700 transition-colors disabled:opacity-40"
            title={students.length === 0 ? "No students in this class" : `Print one copy per student (${students.length}) with QR codes`}
          >
            🖨 Print Batched Exam
          </button>
          <button
            onClick={() => window.close()}
            className="px-4 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 transition-colors"
          >
            Close
          </button>
        </div>
      </div>

      {/* ── Single scrollable body ── */}
      <div className="preview-scroll" style={{ flex: 1, minHeight: 0, overflowY: "auto" }}>

      {/* ── Table of contents (screen only) ── */}
      {orderedQuestions.length > 0 && (
        <div className="no-print" style={{ margin: "0 0 24px" }}>
          <div style={{ maxWidth: "210mm", margin: "0 auto", padding: "0 20mm" }}>
          <h2 style={{ fontFamily: "serif", fontSize: "13pt", fontWeight: "bold", color: "#111", marginBottom: "8px", borderBottom: "1px solid #d1d5db", paddingBottom: "4px" }}>
            Questions — {orderedQuestions.length} total
          </h2>
          {/* Header row */}
          <div style={{ display: "grid", gridTemplateColumns: showSections ? "2.5em 12em 2.5em 1fr" : "2.5em 12em 1fr", gap: "0 8px", fontSize: "9.5pt", fontFamily: "sans-serif", borderBottom: "1px solid #e5e7eb", color: "#6b7280", paddingBottom: "4px", fontWeight: 600 }}>
            <span>#</span>
            <span>Code</span>
            {showSections && <span style={{ textAlign: "center" }}>§</span>}
            <span>Parts &amp; Subtopics</span>
          </div>
          </div>
          {orderedQuestions.map((q, qIdx) => (
            <div key={q.id}>
              {/* Info row */}
              <div style={{ maxWidth: "210mm", margin: "0 auto", padding: "0 20mm" }}>
              <div style={{ display: "grid", gridTemplateColumns: showSections ? "2.5em 12em 2.5em 1fr" : "2.5em 12em 1fr", gap: "0 8px", fontSize: "9.5pt", fontFamily: "sans-serif", borderBottom: tocEditors.has(q.id) ? "none" : "1px solid #f3f4f6", padding: "5px 0", alignItems: "start" }}>
                <span style={{ fontWeight: "bold", color: "#374151" }}>{qIdx + 1}</span>
                <span>
                  <button
                    onClick={() => setTocEditors((prev) => { const next = new Set(prev); if (next.has(q.id)) next.delete(q.id); else next.add(q.id); return next; })}
                    style={{ color: "#2563eb", fontFamily: "monospace", fontSize: "8.5pt", background: "none", border: "none", cursor: "pointer", padding: 0, textDecoration: tocEditors.has(q.id) ? "underline" : "none" }}
                  >
                    {q.code}
                  </button>
                </span>
                {showSections && <span style={{ textAlign: "center", color: "#6b7280" }}>{q.section ?? "—"}</span>}
                <span>
                  {q.parts.length === 0 ? (
                    <span style={{ color: "#9ca3af" }}>—</span>
                  ) : (
                    <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
                      {q.parts.map((p) => (
                        <div key={p.id} style={{ display: "flex", alignItems: "baseline", gap: "6px", flexWrap: "wrap" }}>
                          <span style={{ background: "#eff6ff", border: "1px solid #bfdbfe", borderRadius: "3px", padding: "0 5px", color: "#1d4ed8", whiteSpace: "nowrap", flexShrink: 0 }}>
                            {p.part_label || ""} <span style={{ color: "#6b7280" }}>[{p.marks}]</span>
                          </span>
                          {p.subtopic_codes.length > 0 && (
                            <div style={{ display: "flex", flexWrap: "wrap", gap: "3px" }}>
                              {p.subtopic_codes.map((code) => (
                                <span key={code} style={{ background: "#f0fdf4", border: "1px solid #bbf7d0", borderRadius: "3px", padding: "0 5px", color: "#15803d", whiteSpace: "nowrap", fontFamily: "monospace", fontSize: "8pt" }}>
                                  {code}
                                </span>
                              ))}
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </span>
              </div>
              </div>
              {/* Inline editor — full width within the fixed overlay */}
              {tocEditors.has(q.id) && (
                <div style={{ borderBottom: "1px solid #f3f4f6", padding: "4px 0 12px" }}>
                  <iframe
                    src={`/dashboard/questions/review?focus=${q.id}`}
                    style={{ width: "100%", height: "600px", border: "none", display: "block" }}
                    title={`Editor for ${q.code}`}
                  />
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* ── General exam — shown on screen; printed by "Print General Exam" ── */}
      <div className={printMode === "batched" ? "batched-only" : undefined}>
        {thumbnailUrl && (
          <div
            className="cover-page"
            style={{ position: "relative", width: "210mm", height: "297mm", breakAfter: "page", overflow: "hidden", margin: "0 auto" }}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={thumbnailUrl} alt="Cover page" style={{ position: "absolute", top: 0, left: 0, width: "100%", height: "100%", objectFit: "fill" }} />
          </div>
        )}
        {orderedQuestions.map((q, qIdx) => {
          const globalNum = qIdx + 1;
          const pageNumber = thumbnailUrl ? qIdx + 2 : qIdx + 1;
          const isFirstSectionA = showSections && q.section === "A" && qIdx === 0;
          const isFirstSectionB = showSections && q.section === "B" && (qIdx === 0 || orderedQuestions[qIdx - 1].section !== "B");
          const showSectionAAnswerBox = showSections && q.section === "A" && config?.imageType === "question";
          const totalMarks = questionTotalMarks(q);
          const lineCount = showSectionAAnswerBox ? ibdpDottedLineCount(q) : 0;
          const isLastQuestion = qIdx === orderedQuestions.length - 1;
          return (
            <div key={q.id}>
              <div className="question-page" id={`q-${globalNum}`} style={{ padding: "10mm 12mm 12mm", breakBefore: isFirstSectionA ? undefined : "page", breakInside: "avoid", position: "relative", height: "297mm", boxSizing: "border-box", display: "flex", flexDirection: "column" }}>
                {renderPageChrome(pageNumber, paperCode, { turnOver: !isLastQuestion })}
                {isFirstSectionA && (
                  <div style={{ marginBottom: "4mm" }}>
                    <p style={{ fontFamily: '"Arial", sans-serif', fontSize: "10pt", margin: "0 0 3mm 0", color: "#222" }}>Full marks are not necessarily awarded for a correct answer with no working. Answers must be supported by working and/or explanations. Where an answer is incorrect, some marks may be given for a correct method, provided this is shown by written working. You are therefore advised to show all working.</p>
                    <p style={{ fontFamily: '"Arial", sans-serif', fontSize: "12pt", fontWeight: 700, margin: "0 0 4mm", textAlign: "center" }}>Section A</p>
                    <p style={{ fontFamily: '"Arial", sans-serif', fontSize: "10pt", margin: "0 0 4mm 0", color: "#222" }}>Answer <strong>all</strong> questions. Answers must be written within the answer boxes provided. Working may be continued below the lines, if necessary.</p>
                  </div>
                )}
                {isFirstSectionB && (
                  <div style={{ marginBottom: "4mm" }}>
                    <p style={{ fontFamily: '"Arial", sans-serif', fontSize: "10pt", margin: "0 0 4mm 0", color: "#222" }}>Do <strong>not</strong> write solutions on this page.</p>
                    <p style={{ fontFamily: '"Arial", sans-serif', fontSize: "12pt", fontWeight: 700, margin: "0 0 4mm", textAlign: "center" }}>Section B</p>
                    <p style={{ fontFamily: '"Arial", sans-serif', fontSize: "10pt", margin: "0 0 4mm 0", color: "#222" }}>Answer <strong>all</strong> questions in the answer booklet provided. Please start each question on a new page.</p>
                  </div>
                )}
                <div style={{ display: "flex", alignItems: "baseline", gap: "6mm", marginBottom: "4.5mm", marginTop: "4mm" }}>
                  <p style={{ fontFamily: '"Arial", sans-serif', fontSize: "11pt", fontWeight: 700, margin: 0, color: "#000" }}>{globalNum}.</p>
                  <p style={{ fontFamily: '"Arial", sans-serif', fontSize: "10.5pt", fontWeight: 700, margin: 0, color: "#000" }}>[Maximum mark: {totalMarks}]</p>
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: "4mm" }}>
                  {q.images.length === 0 ? (
                    <p style={{ color: "#999", fontStyle: "italic", fontSize: "10pt" }}>[No images available for this question]</p>
                  ) : (
                    q.images.map((img) => img.url ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img key={img.id} src={img.url} alt={img.alt_text ?? `Question ${globalNum} image ${img.sort_order + 1}`} style={{ maxWidth: "186mm", height: "auto", display: "block" }} />
                    ) : null)
                  )}
                </div>
                {showSectionAAnswerBox && (
                  <div style={{ marginTop: "6mm", width: "100%", flex: 1, minHeight: "36mm", display: "flex", flexDirection: "column" }}>
                    <div
                      style={{
                        border: "1px solid #000",
                        flex: 1,
                        boxSizing: "border-box",
                        padding: "3.5mm 4mm 2mm",
                        display: "flex",
                        flexDirection: "column",
                        justifyContent: "flex-start",
                      }}
                      aria-label={`Section A answer box for question ${globalNum}`}
                    >
                      {renderIbdpDottedLines(`line-${q.id}`, lineCount)}
                    </div>
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* ── Per-student batched blocks — hidden on screen; printed by "Print Batched Exam" ── */}
      <div className="general-only">
        {students.map((student, sIdx) => {
          const name = studentDisplayName(student);
          return (
            <div key={student.id} className="student-block" style={{ breakBefore: sIdx === 0 ? undefined : "page" }}>
              {thumbnailUrl && (
                <div className="cover-page" style={{ position: "relative", width: "210mm", height: "297mm", breakAfter: "page", overflow: "hidden", margin: "0 auto" }}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={thumbnailUrl} alt="Cover page" style={{ position: "absolute", top: 0, left: 0, width: "100%", height: "100%", objectFit: "fill" }} />
                  {nameField ? (
                    <div style={{ position: "absolute", left: `${nameField.x * 100}%`, top: `${nameField.y * 100}%`, width: `${nameField.w * 100}%`, height: `${nameField.h * 100}%`, display: "flex", alignItems: "center", fontFamily: "serif", fontSize: "14pt", fontWeight: "normal", color: "#000", overflow: "hidden", whiteSpace: "nowrap" }}>
                      {name}
                    </div>
                  ) : (
                    <div style={{ position: "absolute", top: "8mm", right: "10mm", fontFamily: "serif", fontSize: "13pt", color: "#000" }}>{name}</div>
                  )}
                </div>
              )}
              {orderedQuestions.map((q, qIdx) => {
                const globalNum = qIdx + 1;
                const pageNumber = (thumbnailUrl ? 2 : 1) + sIdx * orderedQuestions.length + qIdx;
                const isFirstSectionA = showSections && q.section === "A" && qIdx === 0;
                const isFirstSectionB = showSections && q.section === "B" && (qIdx === 0 || orderedQuestions[qIdx - 1].section !== "B");
                const qrUrl = qrCodes[student.id]?.[q.code] ?? "";
                const showSectionAAnswerBox = showSections && q.section === "A" && config?.imageType === "question";
                const totalMarks = questionTotalMarks(q);
                const lineCount = showSectionAAnswerBox ? ibdpDottedLineCount(q) : 0;
                const hasSectionAAnswerBox = showSectionAAnswerBox;
                const isLastQuestion = qIdx === orderedQuestions.length - 1;
                return (
                  <div key={q.id}>
                    <div
                      className="question-page"
                      style={{
                        padding: `10mm 12mm ${hasSectionAAnswerBox || qrUrl ? "26mm" : "12mm"}`,
                        breakBefore: isFirstSectionA ? undefined : "page",
                        breakInside: "avoid",
                        position: "relative",
                        height: "297mm",
                        boxSizing: "border-box",
                        display: "flex",
                        flexDirection: "column",
                      }}
                    >
                      {renderPageChrome(pageNumber, paperCode, { turnOver: !isLastQuestion })}
                      {isFirstSectionA && (
                        <div style={{ marginBottom: "4mm" }}>
                          <p style={{ fontFamily: '"Arial", sans-serif', fontSize: "10pt", margin: "0 0 3mm 0", color: "#222" }}>Full marks are not necessarily awarded for a correct answer with no working. Answers must be supported by working and/or explanations. Where an answer is incorrect, some marks may be given for a correct method, provided this is shown by written working. You are therefore advised to show all working.</p>
                          <p style={{ fontFamily: '"Arial", sans-serif', fontSize: "12pt", fontWeight: 700, margin: "0 0 4mm", textAlign: "center" }}>Section A</p>
                          <p style={{ fontFamily: '"Arial", sans-serif', fontSize: "10pt", margin: "0 0 4mm 0", color: "#222" }}>Answer <strong>all</strong> questions. Answers must be written within the answer boxes provided. Working may be continued below the lines, if necessary.</p>
                        </div>
                      )}
                      {isFirstSectionB && (
                        <div style={{ marginBottom: "4mm" }}>
                          <p style={{ fontFamily: '"Arial", sans-serif', fontSize: "10pt", margin: "0 0 4mm 0", color: "#222" }}>Do <strong>not</strong> write solutions on this page.</p>
                          <p style={{ fontFamily: '"Arial", sans-serif', fontSize: "12pt", fontWeight: 700, margin: "0 0 4mm", textAlign: "center" }}>Section B</p>
                          <p style={{ fontFamily: '"Arial", sans-serif', fontSize: "10pt", margin: "0 0 4mm 0", color: "#222" }}>Answer <strong>all</strong> questions in the answer booklet provided. Please start each question on a new page.</p>
                        </div>
                      )}
                      <div style={{ display: "flex", alignItems: "baseline", gap: "6mm", marginBottom: "4.5mm", marginTop: "4mm" }}>
                        <p style={{ fontFamily: '"Arial", sans-serif', fontSize: "11pt", fontWeight: 700, margin: 0, color: "#000" }}>{globalNum}.</p>
                        <p style={{ fontFamily: '"Arial", sans-serif', fontSize: "10.5pt", fontWeight: 700, margin: 0, color: "#000" }}>[Maximum mark: {totalMarks}]</p>
                      </div>
                      <div style={{ display: "flex", flexDirection: "column", gap: "4mm" }}>
                        {q.images.length === 0 ? (
                          <p style={{ color: "#999", fontStyle: "italic", fontSize: "10pt" }}>[No images available for this question]</p>
                        ) : (
                          q.images.map((img) => img.url ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img key={img.id} src={img.url} alt={img.alt_text ?? `Question ${globalNum} image ${img.sort_order + 1}`} style={{ maxWidth: "186mm", height: "auto", display: "block" }} />
                          ) : null)
                        )}
                      </div>
                      {showSectionAAnswerBox && (
                        <div style={{ marginTop: "6mm", width: "100%", flex: 1, minHeight: "36mm", display: "flex", flexDirection: "column" }}>
                          <div
                            style={{
                              border: "1px solid #000",
                              flex: 1,
                              boxSizing: "border-box",
                              padding: "3.5mm 4mm 2mm",
                              display: "flex",
                              flexDirection: "column",
                              justifyContent: "flex-start",
                            }}
                            aria-label={`Section A answer box for question ${globalNum}`}
                          >
                            {renderIbdpDottedLines(`line-batched-${q.id}`, lineCount)}
                          </div>
                        </div>
                      )}
                      {qrUrl && (
                        <div style={{ position: "absolute", bottom: "8mm", right: "15mm", display: "flex", flexDirection: "column", alignItems: "center", gap: "1mm" }}>
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img src={qrUrl} alt="QR" style={{ width: 56, height: 56 }} />
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>

      {students.length === 0 && !loading && (
        <p className="no-print text-center text-gray-400 text-sm mt-8">No students found for this class — batched print unavailable.</p>
      )}

      <style>{`
        /* Screen: always hide batched blocks */
        @media screen {
          .general-only { display: none !important; }
        }

        @media print {
          .no-print { display: none !important; }

          /* General print: hide batched blocks */
          body.print-general .general-only { display: none !important; }
          /* Batched print: hide general block */
          body.print-batched .batched-only { display: none !important; }
          /* Default (no class set): treat as general */
          body:not(.print-batched) .general-only { display: none !important; }

          @page {
            size: A4;
            margin: 0;
          }

          body {
            margin: 0;
            padding: 0;
          }

          .preview-root {
            position: static !important;
            inset: auto !important;
            z-index: auto !important;
            overflow: visible !important;
            display: block !important;
            height: auto !important;
            background: white !important;
          }

          .preview-scroll {
            overflow: visible !important;
            height: auto !important;
            min-height: 0 !important;
            display: block !important;
          }

          .cover-page {
            width: 210mm !important;
            height: 297mm !important;
            break-after: page !important;
            page-break-after: always !important;
          }

          .question-page {
            min-height: 0 !important;
          }

          .section-header {
            break-before: page !important;
            page-break-before: always !important;
          }
        }
      `}</style>
      </div> {/* end scrollable body */}
    </div>
  );
}

