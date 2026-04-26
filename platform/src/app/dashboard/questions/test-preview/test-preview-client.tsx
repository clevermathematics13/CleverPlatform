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
  const [config, setConfig] = useState<TestBuilderConfig | null>(null);
  const [questions, setQuestions] = useState<TestQuestion[]>([]);
  const [students, setStudents] = useState<Student[]>([]);
  const [thumbnailUrl, setThumbnailUrl] = useState<string | null>(null);
  const [nameField, setNameField] = useState<NameField | null>(null);
  // qrCodes[studentId][questionCode] = data URL
  const [qrCodes, setQrCodes] = useState<Record<string, Record<string, string>>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const printTriggered = useRef(false);

  // ── Load config from sessionStorage ────────────────────────────────────────
  useEffect(() => {
    try {
      const raw = sessionStorage.getItem("testBuilderConfig");
      if (!raw) {
        setError("No exam configuration found. Please return to the question bank and build a test.");
        setLoading(false);
        return;
      }
      setConfig(JSON.parse(raw) as TestBuilderConfig);
    } catch {
      setError("Failed to read exam configuration.");
      setLoading(false);
    }
  }, []);

  // ── Fetch data once config is loaded ───────────────────────────────────────
  useEffect(() => {
    if (!config) return;

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
        setQuestions(qs ?? []);

        if (studentsRes.ok) {
          const { students: ss } = await studentsRes.json();
          setStudents(ss ?? []);
        }

        if (coverRes.ok) {
          const { thumbnailUrl: tu, nameField: nf } = await coverRes.json();
          setThumbnailUrl(tu ?? null);
          setNameField(nf ?? null);
        }
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
      <div className="flex items-center justify-center min-h-screen text-gray-600">
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
      <div className="flex items-center justify-center min-h-screen text-red-600">
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

  return (
    <>
      {/* ── Print controls (hidden in print) ── */}
      <div
        className="no-print fixed top-0 left-0 right-0 z-50 bg-white border-b border-gray-200 px-6 py-3 flex items-center justify-between shadow-sm"
        style={{ printColorAdjust: "exact" }}
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
              printTriggered.current = true;
              window.print();
            }}
            className="px-5 py-2 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700 transition-colors"
          >
            🖨 Print / Save as PDF
          </button>
          <button
            onClick={() => window.close()}
            className="px-4 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 transition-colors"
          >
            Close
          </button>
        </div>
      </div>

      {/* ── Top padding for fixed bar ── */}
      <div className="no-print" style={{ height: 64 }} />

      {/* ── Per-student exam blocks ── */}
      {students.map((student, sIdx) => {
        const name = studentDisplayName(student);
        return (
          <div
            key={student.id}
            className="student-block"
            style={{ breakBefore: sIdx === 0 ? undefined : "page" }}
          >
            {/* Cover page */}
            {thumbnailUrl && (
              <div
                className="cover-page"
                style={{
                  position: "relative",
                  width: "210mm",
                  height: "297mm",
                  breakAfter: "page",
                  overflow: "hidden",
                  margin: "0 auto",
                }}
              >
                {/* Slide thumbnail fills the page */}
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={thumbnailUrl}
                  alt="Cover page"
                  style={{
                    position: "absolute",
                    top: 0,
                    left: 0,
                    width: "100%",
                    height: "100%",
                    objectFit: "fill",
                  }}
                />
                {/* Student name overlaid at the {Name} field position */}
                {nameField && (
                  <div
                    style={{
                      position: "absolute",
                      left: `${nameField.x * 100}%`,
                      top: `${nameField.y * 100}%`,
                      width: `${nameField.w * 100}%`,
                      height: `${nameField.h * 100}%`,
                      display: "flex",
                      alignItems: "center",
                      // Match IB cover font — Times-like serif, moderate size
                      fontFamily: "serif",
                      fontSize: "14pt",
                      fontWeight: "normal",
                      color: "#000",
                      overflow: "hidden",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {name}
                  </div>
                )}
                {/* Fallback: name in top-right corner if no field found */}
                {!nameField && (
                  <div
                    style={{
                      position: "absolute",
                      top: "8mm",
                      right: "10mm",
                      fontFamily: "serif",
                      fontSize: "13pt",
                      color: "#000",
                    }}
                  >
                    {name}
                  </div>
                )}
              </div>
            )}

            {/* Question pages */}
            {orderedQuestions.map((q, qIdx) => {
              const globalNum = qIdx + 1;
              const isFirstSectionA = showSections && q.section === "A" && qIdx === 0;
              const isFirstSectionB =
                showSections &&
                q.section === "B" &&
                (qIdx === 0 || orderedQuestions[qIdx - 1].section !== "B");
              const qrUrl = qrCodes[student.id]?.[q.code] ?? "";

              return (
                <div key={q.id}>
                  {/* Section A placeholder header */}
                  {isFirstSectionA && (
                    <div
                      className="section-header"
                      style={{
                        borderTop: "2px solid #000",
                        padding: "8mm 20mm 4mm",
                        fontFamily: "serif",
                        fontSize: "16pt",
                        fontWeight: "bold",
                        color: "#000",
                        textAlign: "center",
                        breakBefore: sIdx === 0 && qIdx === 0 ? undefined : "page",
                      }}
                    >
                      {/* TODO: Replace with Section A header image when available */}
                      Section A
                    </div>
                  )}

                  {/* Section B placeholder header */}
                  {isFirstSectionB && (
                    <div
                      className="section-header"
                      style={{
                        borderTop: "2px solid #000",
                        padding: "8mm 20mm 4mm",
                        fontFamily: "serif",
                        fontSize: "16pt",
                        fontWeight: "bold",
                        color: "#000",
                        textAlign: "center",
                        breakBefore: "page",
                      }}
                    >
                      {/* TODO: Replace with Section B header image when available */}
                      Section B
                    </div>
                  )}

                  {/* Question page */}
                  <div
                    className="question-page"
                    style={{
                      padding: "15mm 20mm 10mm",
                      breakBefore:
                        isFirstSectionA || isFirstSectionB ? undefined : "page",
                      breakInside: "avoid",
                      position: "relative",
                      minHeight: "240mm",
                    }}
                  >
                    {/* Question number */}
                    <p
                      style={{
                        fontFamily: "serif",
                        fontSize: "14pt",
                        fontWeight: "bold",
                        marginBottom: "6mm",
                        color: "#000",
                      }}
                    >
                      {globalNum}.
                    </p>

                    {/* Question images */}
                    <div style={{ display: "flex", flexDirection: "column", gap: "4mm" }}>
                      {q.images.length === 0 ? (
                        <p style={{ color: "#999", fontStyle: "italic", fontSize: "10pt" }}>
                          [No images available for this question]
                        </p>
                      ) : (
                        q.images.map((img) =>
                          img.url ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img
                              key={img.id}
                              src={img.url}
                              alt={img.alt_text ?? `Question ${globalNum} image ${img.sort_order + 1}`}
                              style={{
                                maxWidth: "170mm",
                                height: "auto",
                                display: "block",
                              }}
                            />
                          ) : null
                        )
                      )}
                    </div>

                    {/* QR code — bottom right of the question page */}
                    {qrUrl && (
                      <div
                        style={{
                          position: "absolute",
                          bottom: "8mm",
                          right: "15mm",
                          display: "flex",
                          flexDirection: "column",
                          alignItems: "center",
                          gap: "1mm",
                        }}
                      >
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={qrUrl}
                          alt="QR"
                          style={{ width: 56, height: 56 }}
                        />
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        );
      })}

      {/* No students fallback */}
      {students.length === 0 && !loading && (
        <div className="no-print flex items-center justify-center min-h-[200px] text-gray-500">
          <p>No students found for this class. The exam cannot be generated.</p>
        </div>
      )}

      {/* ── Global print styles ── */}
      <style>{`
        @media print {
          .no-print { display: none !important; }

          @page {
            size: A4;
            margin: 0;
          }

          body {
            margin: 0;
            padding: 0;
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
    </>
  );
}
