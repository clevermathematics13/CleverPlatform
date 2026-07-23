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

function ibdpDottedLineCount(): number {
  // Fixed at 12 dotted lines, matching the current official IB AAHL Paper 1
  // format exactly. Verified directly against the May 2025 TZ1 HL paper
  // (2225-7106): every Section A answer box on that paper has exactly 12
  // dotted lines, regardless of the question's mark value (5, 6, 7, 4, 8
  // marks all use 12 lines) or how many images/diagrams the question has.
  // The 12 lines only mark a suggested starting ruled area near the top of
  // the box — the box's *border* extends to fill the rest of the page,
  // giving students unruled working space below the lines (the paper's own
  // instruction is literally "Working may be continued below the lines, if
  // necessary"). This was previously a variable count (12/14/16) tied to
  // image count, which had no basis in the real exam format and also left
  // the box far short of the page (a fixed line count sized to a fixed
  // height, rather than the lines being a small fixed prefix inside a
  // page-filling box).
  return 12;
}

// IB answer lines are actual ". . . . ." dot text, not CSS borders (matches IB paper 2225-7106)
const IB_DOT_ROW =
  ". . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . . .";

// ── Page / box geometry constants ──────────────────────────────────────────
//
// The answer box border now fills all remaining space on the page (matching
// the real IB paper, where the 12 dotted lines are just a suggested
// starting area and the box border extends to near the bottom margin).
// This is safe because the *page* itself is a fixed, print-enforced height
// (see the @media print .question-page rule below) — so a flex:1 box
// filling that fixed-height parent resolves reliably, unlike the earlier
// bug where the page's own height was being deleted at print time.
const PAGE_HEIGHT_MM = 297;
const PAGE_PADDING_TOP_MM = 10;
const PAGE_PADDING_BOTTOM_MM = 12;
const ANSWER_BOX_MARGIN_TOP_MM = 6;
const ANSWER_BOX_MARGIN_BOTTOM_MM = 14;
const ANSWER_BOX_PADDING_TOP_MM = 3.5;
const ANSWER_BOX_PADDING_BOTTOM_MM = 2;
const ANSWER_LINE_SPACING_MM = 3.8; // marginBottom between dotted lines
const ANSWER_LINE_HEIGHT_MM = 3; // approx rendered height of one 8.5pt line

// Estimated rendered height (mm) of the "Section A" instructions block that
// is injected above the first Section A question only (isFirstSectionA
// below: "Full marks are not necessarily awarded...", the "Section A"
// heading, and "Answer all questions..."). Derived from the block's actual
// font sizes/line-heights/margins (10pt body copy wraps to ~2 lines per
// paragraph at this column width, 12pt bold heading, plus the wrapping
// div's 4mm trailing margin), rounded up with a safety buffer for line-wrap
// variability across browsers/exam names.
//
// Before this existed, the image above the answer box was capped to the
// *same* content budget on every Section A page, first page included —
// so on the first page the header text was rendered on top of that budget
// "for free", leaving zero slack against the page's real 297mm boundary
// once the header's actual height was accounted for. With effectively no
// slack, Chrome's print engine would treat the answer box (which has
// breakInside: "avoid") as not fitting on the page and clip it away
// instead of drawing it — and only the first Section A page has this
// header, which is why only question 1 lost its answer box while every
// later Section A question rendered fine.
const SECTION_A_HEADER_HEIGHT_MM = 40;

/**
 * Height (mm) of just the 12 ruled dotted lines themselves (not the whole
 * box — the box border extends well past this). Used only to size the
 * content-area cap above the box; the box's own height is now `flex: 1`
 * (fills remaining page space), not this value.
 */
function rusledLinesHeightMm(lineCount: number): number {
  return lineCount * ANSWER_LINE_HEIGHT_MM + (lineCount - 1) * ANSWER_LINE_SPACING_MM;
}

/**
 * Conservative max height (mm) for the prompt/image content area above the
 * answer box. Reserves enough room for the box's padding + its 12 ruled
 * lines + margins even though the box itself will then stretch further via
 * flex:1 — this keeps long prompts/diagrams from squeezing the ruled lines
 * down below a usable minimum, without capping the box's *total* height
 * (which should always reach the page's bottom margin).
 *
 * `headerHeightMm` additionally reserves room for the "Section A" (or other)
 * instructions block that only appears above the first question of a
 * section — see SECTION_A_HEADER_HEIGHT_MM for why this matters.
 */
function contentMaxHeightMm(lineCount: number, headerHeightMm: number = 0): number {
  const pageUsable = PAGE_HEIGHT_MM - PAGE_PADDING_TOP_MM - PAGE_PADDING_BOTTOM_MM;
  const minBoxHeight =
    ANSWER_BOX_PADDING_TOP_MM + rusledLinesHeightMm(lineCount) + ANSWER_BOX_PADDING_BOTTOM_MM;
  const reserved = ANSWER_BOX_MARGIN_TOP_MM + minBoxHeight + ANSWER_BOX_MARGIN_BOTTOM_MM;
  return pageUsable - reserved - headerHeightMm;
}

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
        marginBottom: lineIdx < lineCount - 1 ? `${ANSWER_LINE_SPACING_MM}mm` : "0",
      }}
    >
      {IB_DOT_ROW}
    </div>
  ));
}

function renderCornerMark(position: "top-left" | "top-right" | "bottom-left" | "bottom-right") {
  const isLeft = position.includes("left");
  const isTop = position.includes("top");
  // Top marks: close to top edge and sides; bottom marks: well inset from the bottom edge
  const edgeOffset = isTop ? "1.5mm" : "22mm";
  const sideOffset = "1.5mm";
  return (
    <div
      aria-hidden="true"
      style={{
        position: "absolute",
        [isLeft ? "left" : "right"]: sideOffset,
        [isTop ? "top" : "bottom"]: edgeOffset,
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

  // Separate section A and B (in queue order within each group).
  //
  // A question with a missing/null `section` is otherwise invisible to the
  // exam (it's filtered out of both groups below, then silently rendered
  // with no Section A/B context and no answer box at all — this previously
  // showed up as some questions printing with no working space). Treat null
  // as Section A: every question in this question bank originates from a
  // paper that has a Section A, and the cost of mis-tagging a genuine
  // Section B question as A is just an extra (harmless) answer box, vs. a
  // genuine Section A question silently getting none.
  const sectionAQuestions = showSections
    ? questions.filter((q) => q.section === "A" || q.section == null)
    : [];
  const sectionBQuestions = showSections
    ? questions.filter((q) => q.section === "B")
    : [];
  // For non-section exams or P3, all questions in order
  const orderedQuestions = showSections
    ? [...sectionAQuestions, ...sectionBQuestions]
    : questions;

  // ─── Print layout audit (in-browser print-preview simulation) ─────────────
  //
  // Measures the *actual rendered* DOM of the general (non-batched) exam —
  // not a guess, not a headless-browser reproduction — to confirm every
  // Section A page really has a visible, correctly-sized, on-page answer
  // box before anyone hits print. This is possible without ever opening the
  // OS print dialog because .question-page already carries its 297mm fixed
  // height, overflow:hidden, and flex column layout as *inline* styles
  // (not just inside the @media print block), so the on-screen DOM already
  // matches print geometry 1:1.
  const [printAudit, setPrintAudit] = useState<{
    status: "idle" | "checking" | "done";
    issues: { questionNumber: number; code: string; kind: "missing" | "short" | "overflow"; detail: string }[];
    checkedCount: number;
  }>({ status: "idle", issues: [], checkedCount: 0 });

  async function runPrintLayoutAudit() {
    setPrintAudit({ status: "checking", issues: [], checkedCount: 0 });

    // Wait for every question image to finish loading before measuring —
    // an unloaded image reports 0 intrinsic height, which would mask a
    // real layout bug (and is itself a separate potential cause of print
    // bugs if someone hits print before images finish loading).
    const imgs = Array.from(document.querySelectorAll<HTMLImageElement>(".question-page img"));
    await Promise.all(
      imgs.map((img) =>
        img.complete
          ? Promise.resolve()
          : new Promise<void>((resolve) => {
              img.addEventListener("load", () => resolve(), { once: true });
              img.addEventListener("error", () => resolve(), { once: true });
            })
      )
    );
    // Let layout settle after any image-driven reflow.
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));

    const MM_PER_PX = 25.4 / 96; // CSS px → mm; exact by the CSS spec, independent of screen DPI
    const MIN_USEFUL_BOX_HEIGHT_MM = 60; // healthy boxes measure ~100mm+; well below that means clipped/broken

    const issues: { questionNumber: number; code: string; kind: "missing" | "short" | "overflow"; detail: string }[] = [];
    const pages = Array.from(document.querySelectorAll<HTMLElement>('.question-page[id^="q-"]'));
    let checked = 0;

    pages.forEach((pageEl) => {
      const globalNum = Number(pageEl.id.replace("q-", ""));
      const q = orderedQuestions[globalNum - 1];
      if (!q) return;
      const shouldHaveBox = showSections && q.section !== "B" && config?.imageType === "question";
      if (!shouldHaveBox) return;
      checked += 1;

      const pageRect = pageEl.getBoundingClientRect();
      const boxEl = pageEl.querySelector<HTMLElement>('[aria-label^="Section A answer box"]');

      if (!boxEl) {
        issues.push({
          questionNumber: globalNum,
          code: q.code,
          kind: "missing",
          detail: "No answer box element was rendered on this page at all.",
        });
        return;
      }

      const boxRect = boxEl.getBoundingClientRect();
      const heightMm = boxRect.height * MM_PER_PX;

      if (heightMm < MIN_USEFUL_BOX_HEIGHT_MM) {
        issues.push({
          questionNumber: globalNum,
          code: q.code,
          kind: "short",
          detail: `Answer box is only ${heightMm.toFixed(0)}mm tall (expected ~100mm+) — likely clipped by the page boundary.`,
        });
      }

      // 1px epsilon for sub-pixel rounding.
      if (boxRect.bottom > pageRect.bottom + 1) {
        const overflowMm = (boxRect.bottom - pageRect.bottom) * MM_PER_PX;
        issues.push({
          questionNumber: globalNum,
          code: q.code,
          kind: "overflow",
          detail: `Answer box extends ${overflowMm.toFixed(1)}mm past this page's bottom edge.`,
        });
      }
    });

    setPrintAudit({ status: "done", issues, checkedCount: checked });
  }

  // Auto-run once the exam is fully loaded and there's something to check.
  useEffect(() => {
    if (loading || error || !config || orderedQuestions.length === 0) return;
    if (!showSections || config.imageType !== "question") return;
    const t = setTimeout(() => {
      runPrintLayoutAudit();
    }, 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, error, config, orderedQuestions.length]);

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
          {showSections && config?.imageType === "question" && (
            <button
              onClick={runPrintLayoutAudit}
              disabled={printAudit.status === "checking"}
              className="px-4 py-2 bg-white text-gray-700 border border-gray-300 rounded-lg font-medium hover:bg-gray-50 transition-colors disabled:opacity-50"
              title="Simulate a print preview and verify every Section A answer box is present, sized correctly, and on-page"
            >
              🔍 {printAudit.status === "checking" ? "Checking…" : "Verify Print Layout"}
            </button>
          )}
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

      {/* ── Print layout audit banner (hidden in print) ── */}
      {printAudit.status !== "idle" && (
        <div
          className="no-print"
          style={{
            padding: "8px 24px",
            fontSize: "13px",
            lineHeight: 1.5,
            borderBottom: "1px solid #e5e7eb",
            flexShrink: 0,
            background: printAudit.status === "checking" ? "#eff6ff" : printAudit.issues.length > 0 ? "#fffbeb" : "#f0fdf4",
            color: printAudit.status === "checking" ? "#1e40af" : printAudit.issues.length > 0 ? "#92400e" : "#166534",
          }}
        >
          {printAudit.status === "checking" && "🔍 Simulating print layout — verifying every Section A answer box…"}
          {printAudit.status === "done" && printAudit.issues.length === 0 && (
            <span>✅ Print layout check passed — all {printAudit.checkedCount} Section A answer box{printAudit.checkedCount !== 1 ? "es are" : " is"} present, correctly sized, and on-page.</span>
          )}
          {printAudit.status === "done" && printAudit.issues.length > 0 && (
            <div>
              <strong>⚠️ Print layout check found {printAudit.issues.length} issue{printAudit.issues.length !== 1 ? "s" : ""} (checked {printAudit.checkedCount} Section A page{printAudit.checkedCount !== 1 ? "s" : ""}):</strong>
              <ul style={{ margin: "4px 0 0", paddingLeft: "20px" }}>
                {printAudit.issues.map((iss, i) => (
                  <li key={i}>Q{iss.questionNumber} ({iss.code}): {iss.detail}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

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
          const isFirstSectionA = showSections && q.section !== "B" && qIdx === 0;
          const isFirstSectionB = showSections && q.section === "B" && (qIdx === 0 || orderedQuestions[qIdx - 1].section !== "B");
          const showSectionAAnswerBox = showSections && q.section !== "B" && config?.imageType === "question";
          const totalMarks = questionTotalMarks(q);
          const lineCount = showSectionAAnswerBox ? ibdpDottedLineCount() : 0;
          // Content-area cap reserves room for the box's fixed 12 ruled
          // lines + padding/margins; the box itself then stretches via
          // flex:1 to consume whatever space remains on the page (see
          // showSectionAAnswerBox block below). On the first Section A
          // page, also reserve room for the instructions header block
          // that's injected above the question on that page only — see
          // SECTION_A_HEADER_HEIGHT_MM.
          const contentMaxMm = showSectionAAnswerBox
            ? contentMaxHeightMm(lineCount, isFirstSectionA ? SECTION_A_HEADER_HEIGHT_MM : 0)
            : undefined;
          const isLastQuestion = qIdx === orderedQuestions.length - 1;
          return (
            <div key={q.id}>
              <div
                className="question-page"
                id={`q-${globalNum}`}
                style={{
                  padding: `${PAGE_PADDING_TOP_MM}mm 12mm ${PAGE_PADDING_BOTTOM_MM}mm`,
                  breakBefore: isFirstSectionA ? undefined : "page",
                  breakInside: "avoid",
                  position: "relative",
                  height: `${PAGE_HEIGHT_MM}mm`,
                  boxSizing: "border-box",
                  display: "flex",
                  flexDirection: "column",
                  overflow: "hidden",
                }}
              >
                {renderPageChrome(pageNumber, paperCode, { turnOver: !isLastQuestion })}
                <div style={{ maxHeight: contentMaxMm != null ? `${contentMaxMm}mm` : undefined, overflow: "hidden", flex: "0 0 auto" }}>
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
                      // Native img max-height (not a container's overflow:hidden) is what
                      // Chrome's print engine actually respects for scaling a replaced
                      // element down to fit — a div clipping its overflow is not reliable
                      // here (this is what let an oversized source image bleed straight
                      // through the content cap and collide with the answer box below).
                      // Some source images are a full scanned exam page that already
                      // includes its own answer box (a question-bank content issue, not a
                      // template issue); capping height here keeps any such image readable
                      // and on-page instead of overflowing, even though the ideal fix is
                      // re-cropping that source image to prompt-only.
                      // eslint-disable-next-line @next/next/no-img-element
                      <img key={img.id} src={img.url} alt={img.alt_text ?? `Question ${globalNum} image ${img.sort_order + 1}`} style={{ maxWidth: "186mm", maxHeight: contentMaxMm != null ? `${contentMaxMm}mm` : undefined, width: "auto", height: "auto", display: "block" }} />
                    ) : null)
                  )}
                </div>
                </div>
                {showSectionAAnswerBox && (
                  <div
                    style={{
                      // The box border now fills all remaining page space
                      // (flex:1) instead of stopping after a fixed height —
                      // matching the real IB paper, where the bordered
                      // answer box always extends to near the bottom
                      // margin regardless of how many ruled lines it
                      // contains. This is safe now because the *page*
                      // (.question-page) has a print-enforced fixed height
                      // (see the @media print rule below); a flex:1 child
                      // of a genuinely fixed-height flex parent resolves
                      // correctly, which is what was missing before.
                      flex: "1 1 auto",
                      minHeight: 0,
                      marginTop: `${ANSWER_BOX_MARGIN_TOP_MM}mm`,
                      marginBottom: `${ANSWER_BOX_MARGIN_BOTTOM_MM}mm`,
                      border: "1px solid #000",
                      boxSizing: "border-box",
                      padding: `${ANSWER_BOX_PADDING_TOP_MM}mm 4mm ${ANSWER_BOX_PADDING_BOTTOM_MM}mm`,
                      overflow: "hidden",
                      breakInside: "avoid",
                    }}
                    aria-label={`Section A answer box for question ${globalNum}`}
                  >
                    {renderIbdpDottedLines(`line-${q.id}`, lineCount)}
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
                const isFirstSectionA = showSections && q.section !== "B" && qIdx === 0;
                const isFirstSectionB = showSections && q.section === "B" && (qIdx === 0 || orderedQuestions[qIdx - 1].section !== "B");
                const qrUrl = qrCodes[student.id]?.[q.code] ?? "";
                const showSectionAAnswerBox = showSections && q.section !== "B" && config?.imageType === "question";
                const totalMarks = questionTotalMarks(q);
                const lineCount = showSectionAAnswerBox ? ibdpDottedLineCount() : 0;
                const contentMaxMm = showSectionAAnswerBox
                  ? contentMaxHeightMm(lineCount, isFirstSectionA ? SECTION_A_HEADER_HEIGHT_MM : 0)
                  : undefined;
                const isLastQuestion = qIdx === orderedQuestions.length - 1;
                return (
                  <div key={q.id}>
                    <div
                      className="question-page"
                      style={{
                        padding: `${PAGE_PADDING_TOP_MM}mm 12mm ${PAGE_PADDING_BOTTOM_MM}mm`,
                        breakBefore: isFirstSectionA ? undefined : "page",
                        breakInside: "avoid",
                        position: "relative",
                        height: `${PAGE_HEIGHT_MM}mm`,
                        boxSizing: "border-box",
                        display: "flex",
                        flexDirection: "column",
                        overflow: "hidden",
                      }}
                    >
                      {renderPageChrome(pageNumber, paperCode, { turnOver: !isLastQuestion })}
                      <div style={{ maxHeight: contentMaxMm != null ? `${contentMaxMm}mm` : undefined, overflow: "hidden", flex: "0 0 auto" }}>
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
                            <img key={img.id} src={img.url} alt={img.alt_text ?? `Question ${globalNum} image ${img.sort_order + 1}`} style={{ maxWidth: "186mm", maxHeight: contentMaxMm != null ? `${contentMaxMm}mm` : undefined, width: "auto", height: "auto", display: "block" }} />
                          ) : null)
                        )}
                      </div>
                      </div>
                      {showSectionAAnswerBox && (
                        <div
                          style={{
                            flex: "1 1 auto",
                            minHeight: 0,
                            marginTop: `${ANSWER_BOX_MARGIN_TOP_MM}mm`,
                            border: "1px solid #000",
                            boxSizing: "border-box",
                            padding: `${ANSWER_BOX_PADDING_TOP_MM}mm 4mm ${ANSWER_BOX_PADDING_BOTTOM_MM}mm`,
                            overflow: "hidden",
                            breakInside: "avoid",
                          }}
                          aria-label={`Section A answer box for question ${globalNum}`}
                        >
                          {renderIbdpDottedLines(`line-batched-${q.id}`, lineCount)}
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

          /*
           * This page wrapper must keep a print-enforced fixed height equal
           * to the inline screen value (297mm) — deleting it here (e.g. back
           * to "min-height: 0") removes the only thing the answer box's
           * flex:1 fill can size itself against, which previously caused
           * the box (and the whole page) to collapse to natural content
           * height and let Chrome's print engine paginate on the wrong
           * boundary. See the box's own inline comment for the full
           * explanation of why flex:1 is safe here.
           */
          .question-page {
            height: 297mm !important;
            min-height: 297mm !important;
            max-height: 297mm !important;
            overflow: hidden !important;
            page-break-inside: avoid !important;
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
