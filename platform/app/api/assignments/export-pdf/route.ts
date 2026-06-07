import { getApiTeacher } from "@/lib/auth";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

type ExportRequest = {
  title: string;
  subtitle: string;
  instructions: string[];
  sections: Array<{
    heading: string;
    questions: Array<{
      prompt: string;
      marks?: number;
      answer?: string;
      answerBoxLines?: number;
    }>;
  }>;
  formatting: {
    schoolName: string;
    teacherName: string;
    includeNameLine: boolean;
    includeDateLine: boolean;
    includeMarksColumn: boolean;
    includeAnswerKey: boolean;
    fontSize: 10 | 11 | 12;
    lineSpacing: "compact" | "normal" | "relaxed";
    pageMarginsMm: 12 | 16 | 20;
    numberingStyle: "numeric" | "lettered";
    answerBoxLines?: number;
    answerStyle?: "boxes" | "lines" | "none";
  };
};

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function formatQuestionLabel(
  sectionIndex: number,
  questionIndex: number,
  numberingStyle: "numeric" | "lettered"
): string {
  if (numberingStyle === "lettered") {
    const code = "a".charCodeAt(0) + questionIndex;
    return `(${String.fromCharCode(code)})`;
  }
  return `${sectionIndex + 1}.${questionIndex + 1}`;
}

function generatePdfHtml(request: ExportRequest): string {
  const { title, subtitle, instructions, sections, formatting } = request;

  const instructionsHtml = instructions
    .map((line, index) => `<li>${escapeHtml(`${index + 1}. ${line}`)}</li>`)
    .join("");

  const sectionsHtml = sections
    .map((section, sectionIndex) => {
      const questionRows = section.questions
        .map((question, questionIndex) => {
          const label = formatQuestionLabel(sectionIndex, questionIndex, formatting.numberingStyle);
          const marks = formatting.includeMarksColumn
            ? `<span class="marks">[${question.marks ?? 0}]</span>`
            : "";
          const answerStyle = formatting.answerStyle ?? "boxes";
          const lines = question.answerBoxLines ?? formatting.answerBoxLines ?? 4;
          let answerHtml = "";
          if (answerStyle !== "none") {
            const ruledLines = Array.from({ length: lines }, () => '<div class="answer-line"></div>').join("");
            answerHtml = answerStyle === "boxes"
              ? `<div class="answer-box-bordered">${ruledLines}</div>`
              : `<div class="answer-bare-lines">${ruledLines}</div>`;
          }
          return `<div class="question-block"><div class="q-row"><span class="q-label">${escapeHtml(label)}</span><span class="q-text">${escapeHtml(
            question.prompt
          )}</span>${marks}</div>${answerHtml}</div>`;
        })
        .join("");

      return `<section><h3>${escapeHtml(section.heading)}</h3>${questionRows}</section>`;
    })
    .join("");

  const answersHtml = formatting.includeAnswerKey
    ? `<section class="answers"><h3>Answer Key</h3>${sections
        .map((section, sectionIndex) =>
          section.questions
            .map((question, questionIndex) => {
              const label = formatQuestionLabel(sectionIndex, questionIndex, formatting.numberingStyle);
              return `<div class="answer-row"><span class="q-label">${escapeHtml(label)}</span><span>${escapeHtml(
                question.answer ?? ""
              )}</span></div>`;
            })
            .join("")
        )
        .join("")}</section>`
    : "";

  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <title>${escapeHtml(title)}</title>
  <style>
    @page { size: A4; margin: ${formatting.pageMarginsMm}mm; }
    * { margin: 0; padding: 0; }
    body { font-family: Georgia, "Times New Roman", serif; color: #111; font-size: ${formatting.fontSize}pt; line-height: ${
      formatting.lineSpacing === "compact" ? "1.3" : formatting.lineSpacing === "relaxed" ? "1.7" : "1.5"
    }; }
    h1, h2, h3 { margin: 0; margin-top: 0.5em; }
    h3 { margin-top: 1em; }
    .doc-head { border-bottom: 1px solid #cfcfcf; padding-bottom: 8px; margin-bottom: 14px; }
    .school { text-align: center; text-transform: uppercase; font-size: 9pt; letter-spacing: 0.08em; margin-bottom: 4px; }
    .title { text-align: center; margin-top: 6px; margin-bottom: 2px; font-size: 18pt; font-weight: bold; }
    .subtitle { text-align: center; margin-top: 2px; margin-bottom: 8px; font-size: 10pt; color: #444; }
    .meta { margin-bottom: 8px; font-size: 10pt; display: flex; gap: 20px; flex-wrap: wrap; }
    .meta-line { min-width: 200px; }
    ul { margin: 8px 0 12px 18px; padding: 0; }
    li { margin: 2px 0; }
    section { margin-top: 12px; page-break-inside: avoid; }
    .q-row { display: grid; grid-template-columns: auto 1fr auto; gap: 8px; margin: 6px 0; align-items: start; }
    .q-label { font-weight: 600; min-width: 30px; }
    .q-text { white-space: pre-wrap; word-wrap: break-word; }
    .marks { font-size: 9pt; color: #555; text-align: right; }
    .question-block { break-inside: avoid; page-break-inside: avoid; margin: 8px 0; }
    .answer-box-bordered { margin: 6px 0 14px 38px; border: 1pt solid #999; border-radius: 2px; break-inside: avoid; page-break-inside: avoid; }
    .answer-box-bordered .answer-line { border-bottom: 0.5pt solid #ddd; height: 8mm; min-height: 8mm; }
    .answer-box-bordered .answer-line:last-child { border-bottom: none; }
    .answer-bare-lines { margin: 4px 0 12px 38px; }
    .answer-bare-lines .answer-line { border-bottom: 0.5pt solid #bbb; height: 8mm; min-height: 8mm; }
    .answers { border-top: 1px solid #cfcfcf; margin-top: 18px; padding-top: 10px; }
    .answer-row { display: grid; grid-template-columns: auto 1fr; gap: 8px; margin: 4px 0; }
  </style>
</head>
<body>
  <div class="doc-head">
    <div class="school">${escapeHtml(formatting.schoolName)}</div>
    <h1 class="title">${escapeHtml(title)}</h1>
    <h2 class="subtitle">${escapeHtml(subtitle)}</h2>
    <div class="meta">
      ${formatting.includeNameLine ? `<div class="meta-line">Name: ____________________</div>` : ""}
      ${formatting.includeDateLine ? `<div class="meta-line">Date: ____________________</div>` : ""}
      ${formatting.teacherName ? `<div class="meta-line">Teacher: ${escapeHtml(formatting.teacherName)}</div>` : ""}
    </div>
  </div>

  <h3>Instructions</h3>
  <ul>${instructionsHtml}</ul>
  ${sectionsHtml}
  ${answersHtml}
</body>
</html>`;
}

export async function POST(req: Request) {
  try {
    const auth = await getApiTeacher();
    if (!auth.ok) return auth.response;
    const body = (await req.json()) as ExportRequest;

    const html = generatePdfHtml(body);

    // Return as HTML with headers that encourage browser print-to-PDF
    return new NextResponse(html, {
      status: 200,
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "Content-Disposition": `inline; filename="${(body.title || "assignment").replace(/[^a-z0-9]/gi, "_")}.html"`,
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "PDF export error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
