"use client";

import { useState, useEffect, useRef } from "react";
import LatexRenderer from "@/components/LatexRenderer";
import { IB_CORRECTION_SYSTEM, IB_CLASSIFY_SYSTEM } from "@/lib/latex-utils";
import { readJsonSafely } from "@/lib/http-json";
import { splitDraftIntoParts } from "./review/split-draft-into-parts";
import { hasExplicitTopLevelPartStructure } from "./part-structure";

// ─── Types ──────────────────────────────────────────────────────────────────

interface Subtopic {
  code: string;
  descriptor: string;
  section: number;
}

interface PendingImage {
  id: string;
  imageType: "question" | "markscheme";
  file: File;
  objectUrl: string;
}

interface WizardPart {
  localId: string;
  label: string;
  marks: string;
  commandTerm: string;
  subtopicCodes: string[];
  contentLatex: string;
  markschemeLatex: string;
}

type WizardStep = "images" | "processing" | "review";
type Field = "content_latex" | "markscheme_latex";

const SECTION_NAMES: Record<number, string> = {
  1: "Number & Algebra",
  2: "Functions",
  3: "Geometry & Trig",
  4: "Stats & Probability",
  5: "Calculus",
};

// ─── Helpers ────────────────────────────────────────────────────────────────

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve((reader.result as string).split(",")[1]);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

/** Detect top-level part labels (a), (b), etc. from raw OCR text */
function detectPartLabels(text: string): string[] {
  const labels: string[] = [];
  const seen = new Set<string>();
  // Match (a)-(z) followed by whitespace, backslash, dollar, or end; capture single letters only
  const re = /\(([a-z])\)(?=[\s\n\\$]|$)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    if (!seen.has(m[1])) {
      seen.add(m[1]);
      labels.push(m[1]);
    }
  }
  return labels;
}

// ─── WizardStemEditor ────────────────────────────────────────────────────────

function WizardStemEditor({
  stemLatex,
  stemMsLatex,
  activeField,
  onSave,
}: {
  stemLatex: string;
  stemMsLatex: string;
  activeField: Field;
  onSave: (field: "stem_latex" | "stem_markscheme_latex", value: string) => void;
}) {
  const stemField =
    activeField === "content_latex" ? ("stem_latex" as const) : ("stem_markscheme_latex" as const);
  const [editing, setEditing] = useState(false);
  const [draftQ, setDraftQ] = useState(stemLatex);
  const [draftMS, setDraftMS] = useState(stemMsLatex);
  const [claudeInstruction, setClaudeInstruction] = useState("");
  const [claudeLoading, setClaudeLoading] = useState(false);

  // Sync when parent updates (e.g., "Apply to editors" from draft panel)
  useEffect(() => {
    if (!editing) {
      setDraftQ(stemLatex);
      setDraftMS(stemMsLatex);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stemLatex, stemMsLatex]);

  const currentDraft = stemField === "stem_latex" ? draftQ : draftMS;
  const setCurrentDraft = (val: string) => {
    if (stemField === "stem_latex") setDraftQ(val);
    else setDraftMS(val);
  };

  async function runClaude() {
    if (!claudeInstruction.trim()) return;
    setClaudeLoading(true);
    try {
      const res = await fetch("/api/claude", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          system: IB_CORRECTION_SYSTEM,
          messages: [
            {
              role: "user",
              content: `Here is the current LaTeX for the question stem:\n\n\`\`\`\n${currentDraft}\n\`\`\`\n\nInstruction: ${claudeInstruction}\n\nReturn ONLY the corrected LaTeX, nothing else.`,
            },
          ],
        }),
      });
      const data = await readJsonSafely<{ content?: { text?: string }[]; error?: string }>(res);
      if (!res.ok) {
        throw new Error(data?.error ?? `HTTP ${res.status}`);
      }
      const corrected: string = data?.content?.[0]?.text ?? "";
      if (corrected) setCurrentDraft(corrected.trim());
    } finally {
      setClaudeLoading(false);
      setClaudeInstruction("");
    }
  }

  function save() {
    onSave(stemField, currentDraft);
    setEditing(false);
  }

  return (
    <div className="border border-indigo-200 rounded-lg overflow-hidden bg-indigo-50/30">
      <div className="flex items-center gap-3 px-4 py-2 bg-indigo-50 border-b border-indigo-200">
        <span className="font-semibold text-sm text-indigo-800">
          Initial question
          <span className="text-indigo-400 font-normal ml-1 text-xs">
            (stem — shared across all parts)
          </span>
        </span>
      </div>

      <div className="p-4 space-y-3">
        {editing ? (
          <textarea
            className="w-full border border-indigo-300 rounded-md p-2 font-mono text-sm resize-y min-h-32 text-gray-900 focus:outline-none focus:ring-2 focus:ring-indigo-400"
            value={currentDraft}
            onChange={(e) => setCurrentDraft(e.target.value)}
          />
        ) : (
          <div className="min-h-16 text-sm leading-relaxed">
            {currentDraft ? (
              <LatexRenderer latex={currentDraft} />
            ) : (
              <span className="text-gray-400 italic">No stem content</span>
            )}
          </div>
        )}

        <div className="flex gap-2">
          {editing ? (
            <>
              <button
                onClick={save}
                className="px-3 py-1.5 bg-indigo-600 text-white rounded text-xs font-medium hover:bg-indigo-700"
              >
                Save
              </button>
              <button
                onClick={() => { setDraftQ(stemLatex); setDraftMS(stemMsLatex); setEditing(false); }}
                className="px-3 py-1.5 bg-gray-100 text-gray-700 rounded text-xs font-medium hover:bg-gray-200"
              >
                Cancel
              </button>
            </>
          ) : (
            <button
              onClick={() => setEditing(true)}
              className="px-3 py-1.5 bg-gray-100 text-gray-700 rounded text-xs font-medium hover:bg-gray-200"
            >
              Edit LaTeX
            </button>
          )}
        </div>

        <div className="flex gap-2 pt-1 border-t border-indigo-100">
          <input
            type="text"
            placeholder="Correction for Claude, e.g. 'fix the fraction in line 2'…"
            value={claudeInstruction}
            onChange={(e) => setClaudeInstruction(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && runClaude()}
            className="flex-1 border border-gray-300 rounded-md px-3 py-1.5 text-xs text-gray-900 focus:outline-none focus:ring-2 focus:ring-purple-400"
          />
          <button
            onClick={runClaude}
            disabled={claudeLoading || !claudeInstruction.trim()}
            className="px-3 py-1.5 bg-purple-600 text-white rounded text-xs font-medium hover:bg-purple-700 disabled:opacity-40"
          >
            {claudeLoading ? "…" : "Ask Claude"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── WizardPartEditor ────────────────────────────────────────────────────────

function WizardPartEditor({
  part,
  activeField,
  index,
  availableSubtopics,
  onSaveLatex,
  onMeta,
  onRemove,
}: {
  part: WizardPart;
  activeField: Field;
  index: number;
  availableSubtopics: Subtopic[];
  onSaveLatex: (contentLatex: string, markschemeLatex: string) => void;
  onMeta: (label: string, marks: string, commandTerm: string, subtopicCodes: string[]) => void;
  onRemove: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draftQ, setDraftQ] = useState(part.contentLatex);
  const [draftMS, setDraftMS] = useState(part.markschemeLatex);
  const [claudeInstruction, setClaudeInstruction] = useState("");
  const [claudeLoading, setClaudeLoading] = useState(false);
  const [subtopicsOpen, setSubtopicsOpen] = useState(false);

  // Sync when parent updates (e.g., "Apply to editors")
  useEffect(() => {
    if (!editing) {
      setDraftQ(part.contentLatex);
      setDraftMS(part.markschemeLatex);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [part.contentLatex, part.markschemeLatex]);

  const activeDraft = activeField === "content_latex" ? draftQ : draftMS;
  const setActiveDraft = (val: string) => {
    if (activeField === "content_latex") setDraftQ(val);
    else setDraftMS(val);
  };

  async function runClaude() {
    if (!claudeInstruction.trim()) return;
    setClaudeLoading(true);
    try {
      const res = await fetch("/api/claude", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          system: IB_CORRECTION_SYSTEM,
          messages: [
            {
              role: "user",
              content: `Here is the current LaTeX for this question part:\n\n\`\`\`\n${activeDraft}\n\`\`\`\n\nInstruction: ${claudeInstruction}\n\nReturn ONLY the corrected LaTeX, nothing else.`,
            },
          ],
        }),
      });
      const data = await readJsonSafely<{ content?: { text?: string }[]; error?: string }>(res);
      if (!res.ok) {
        throw new Error(data?.error ?? `HTTP ${res.status}`);
      }
      const corrected: string = data?.content?.[0]?.text ?? "";
      if (corrected) setActiveDraft(corrected.trim());
    } finally {
      setClaudeLoading(false);
      setClaudeInstruction("");
    }
  }

  function save() {
    onSaveLatex(draftQ, draftMS);
    setEditing(false);
  }

  function toggleSubtopic(code: string) {
    const next = part.subtopicCodes.includes(code)
      ? part.subtopicCodes.filter((c) => c !== code)
      : [...part.subtopicCodes, code];
    onMeta(part.label, part.marks, part.commandTerm, next);
  }

  const displayLabel = part.label ? `part ${part.label.toLowerCase()}` : `part ${index + 1}`;
  const marksNum = part.marks !== "" ? Number(part.marks) : null;

  // Group subtopics by section
  const subtopicsBySection = availableSubtopics.reduce<Record<number, Subtopic[]>>((acc, s) => {
    (acc[s.section] ??= []).push(s);
    return acc;
  }, {});

  return (
    <div className="border border-gray-200 rounded-lg overflow-hidden">
      {/* Part header */}
      <div className="flex items-center gap-3 px-4 py-2 bg-gray-50 border-b border-gray-200">
        <span className="font-semibold text-sm text-gray-800">{displayLabel}</span>
        {marksNum != null && (
          <span className="text-xs text-gray-400">
            [{marksNum} mark{marksNum !== 1 ? "s" : ""}]
          </span>
        )}
        <button
          onClick={onRemove}
          className="ml-auto text-xs text-red-500 hover:text-red-700 font-bold px-2 py-0.5 rounded hover:bg-red-50"
        >
          Remove
        </button>
      </div>

      {/* Metadata strip */}
      <div className="px-4 py-3 bg-gray-50/60 border-b border-gray-100 space-y-2">
        <div className="flex flex-wrap gap-3 items-end">
          <div>
            <label className="block text-xs font-bold text-gray-600 mb-0.5">Label</label>
            <input
              type="text"
              value={part.label}
              onChange={(e) => onMeta(e.target.value, part.marks, part.commandTerm, part.subtopicCodes)}
              placeholder="a, bi…"
              className="w-20 rounded border border-gray-300 px-2 py-1 text-xs bg-white text-gray-900 focus:ring-1 focus:ring-blue-400"
            />
          </div>
          <div>
            <label className="block text-xs font-bold text-gray-600 mb-0.5">Marks</label>
            <input
              type="number"
              value={part.marks}
              onChange={(e) => onMeta(part.label, e.target.value, part.commandTerm, part.subtopicCodes)}
              min={0}
              className="w-16 rounded border border-gray-300 px-2 py-1 text-xs bg-white text-gray-900 focus:ring-1 focus:ring-blue-400"
            />
          </div>
          <div>
            <label className="block text-xs font-bold text-gray-600 mb-0.5">Command Term</label>
            <input
              type="text"
              value={part.commandTerm}
              onChange={(e) => onMeta(part.label, part.marks, e.target.value, part.subtopicCodes)}
              placeholder="Find, Show…"
              className="w-32 rounded border border-gray-300 px-2 py-1 text-xs bg-white text-gray-900 focus:ring-1 focus:ring-blue-400"
            />
          </div>
          <button
            type="button"
            onClick={() => setSubtopicsOpen((o) => !o)}
            className="text-xs text-blue-600 underline hover:no-underline self-end pb-1"
          >
            {subtopicsOpen ? "Hide subtopics ▲" : `Subtopics${part.subtopicCodes.length > 0 ? ` (${part.subtopicCodes.length})` : ""} ▼`}
          </button>
        </div>

        {part.subtopicCodes.length > 0 && !subtopicsOpen && (
          <p className="text-xs text-gray-500">
            <span className="font-medium">Topics:</span> {part.subtopicCodes.join(", ")}
          </p>
        )}

        {subtopicsOpen && (
          <div className="border border-gray-200 rounded p-2 bg-white max-h-48 overflow-y-auto space-y-2">
            {Object.entries(subtopicsBySection).map(([sec, subs]) => (
              <div key={sec}>
                <p className="text-xs font-semibold text-gray-500 mb-0.5">
                  {SECTION_NAMES[Number(sec)] ?? `Topic ${sec}`}
                </p>
                <div className="flex flex-wrap gap-1">
                  {subs.map((sub) => (
                    <button
                      key={sub.code}
                      type="button"
                      onClick={() => toggleSubtopic(sub.code)}
                      title={sub.descriptor}
                      className={`rounded px-1.5 py-0.5 text-xs border transition-colors ${
                        part.subtopicCodes.includes(sub.code)
                          ? "bg-blue-600 border-blue-600 text-white"
                          : "bg-white border-gray-300 text-gray-600 hover:bg-gray-50"
                      }`}
                    >
                      {sub.code}
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* LaTeX editor */}
      <div className="p-4 space-y-3">
        {editing ? (
          <textarea
            className="w-full border border-gray-300 rounded-md p-2 font-mono text-sm resize-y min-h-32 text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-400"
            value={activeDraft}
            onChange={(e) => setActiveDraft(e.target.value)}
          />
        ) : (
          <div className="min-h-16 text-sm leading-relaxed">
            {activeDraft ? (
              <LatexRenderer latex={activeDraft} />
            ) : (
              <span className="text-gray-400 italic">No LaTeX content</span>
            )}
          </div>
        )}

        <div className="flex gap-2">
          {editing ? (
            <>
              <button
                onClick={save}
                className="px-3 py-1.5 bg-blue-600 text-white rounded text-xs font-medium hover:bg-blue-700"
              >
                Save
              </button>
              <button
                onClick={() => {
                  setDraftQ(part.contentLatex);
                  setDraftMS(part.markschemeLatex);
                  setEditing(false);
                }}
                className="px-3 py-1.5 bg-gray-100 text-gray-700 rounded text-xs font-medium hover:bg-gray-200"
              >
                Cancel
              </button>
            </>
          ) : (
            <button
              onClick={() => setEditing(true)}
              className="px-3 py-1.5 bg-gray-100 text-gray-700 rounded text-xs font-medium hover:bg-gray-200"
            >
              Edit LaTeX
            </button>
          )}
        </div>

        {/* Claude correction */}
        <div className="flex gap-2 pt-1 border-t border-gray-100">
          <input
            type="text"
            placeholder="Correction for Claude, e.g. 'fix the fraction in line 2'…"
            value={claudeInstruction}
            onChange={(e) => setClaudeInstruction(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && runClaude()}
            className="flex-1 border border-gray-300 rounded-md px-3 py-1.5 text-xs text-gray-900 focus:outline-none focus:ring-2 focus:ring-purple-400"
          />
          <button
            onClick={runClaude}
            disabled={claudeLoading || !claudeInstruction.trim()}
            className="px-3 py-1.5 bg-purple-600 text-white rounded text-xs font-medium hover:bg-purple-700 disabled:opacity-40"
          >
            {claudeLoading ? "…" : "Ask Claude"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── AddQuestionWizard ───────────────────────────────────────────────────────

export function AddQuestionWizard({
  availableSubtopics,
  commandTerms: _commandTerms,
  onAddCustomTerm: _onAddCustomTerm,
  onClose,
  onSaved,
}: {
  availableSubtopics: Subtopic[];
  commandTerms: string[];
  onAddCustomTerm: (term: string) => void;
  onClose: () => void;
  onSaved: () => void;
}) {
  // ── Step state ──
  const [step, setStep] = useState<WizardStep>("images");

  // ── Step 1: metadata ──
  const [code, setCode] = useState("");
  const [sessionVal, setSessionVal] = useState("25M");
  const [paper, setPaper] = useState<1 | 2 | 3>(2);
  const [level, setLevel] = useState("AHL");
  const [timezone, setTimezone] = useState("TZ1");
  const [curricula, setCurricula] = useState<("AA" | "AI")[]>(["AA"]);
  const [pendingImages, setPendingImages] = useState<PendingImage[]>([]);
  const pendingImagesRef = useRef(pendingImages);
  pendingImagesRef.current = pendingImages;
  const [step1Error, setStep1Error] = useState<string | null>(null);

  // ── Processing ──
  const [processingLog, setProcessingLog] = useState<string[]>([]);
  const [processingError, setProcessingError] = useState<string | null>(null);

  // ── Step 2: review ──
  const [questionId, setQuestionId] = useState<string | null>(null);
  const [stemLatex, setStemLatex] = useState("");
  const [stemMsLatex, setStemMsLatex] = useState("");
  const [draftLatex, setDraftLatex] = useState("");
  const [draftMsLatex, setDraftMsLatex] = useState("");
  const [parts, setParts] = useState<WizardPart[]>([]);
  const [activeField, setActiveField] = useState<Field>("content_latex");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  // Clean up object URLs on unmount
  useEffect(() => {
    return () => {
      pendingImagesRef.current.forEach((img) => URL.revokeObjectURL(img.objectUrl));
    };
  }, []);

  // ── Metadata helpers ──

  function handleCodeChange(raw: string) {
    setCode(raw);
    const segs = raw.trim().split(".");
    if (segs.length < 4) return;
    if (segs[0]) setSessionVal(segs[0]);
    const p = parseInt(segs[1]);
    if (!isNaN(p) && [1, 2, 3].includes(p)) setPaper(p as 1 | 2 | 3);
    if (segs[2] === "SL") setLevel("SL");
    else if (segs[2] === "HL" || segs[2] === "AHL") setLevel("AHL");
    if (segs[3] && /^TZ\d+$/.test(segs[3])) setTimezone(segs[3]);
  }

  function toggleCurriculum(c: "AA" | "AI") {
    setCurricula((prev) =>
      prev.includes(c)
        ? prev.length > 1
          ? prev.filter((x) => x !== c)
          : prev
        : [...prev, c]
    );
  }

  // ── Image helpers ──

  function addPendingImage(imageType: "question" | "markscheme", file: File) {
    const objectUrl = URL.createObjectURL(file);
    setPendingImages((prev) => [
      ...prev,
      { id: crypto.randomUUID(), imageType, file, objectUrl },
    ]);
  }

  function removePendingImage(id: string) {
    setPendingImages((prev) => {
      const img = prev.find((i) => i.id === id);
      if (img) URL.revokeObjectURL(img.objectUrl);
      return prev.filter((i) => i.id !== id);
    });
  }

  function handlePasteZone(
    e: React.ClipboardEvent,
    imageType: "question" | "markscheme"
  ) {
    e.stopPropagation();
    const items = Array.from(e.clipboardData.items);
    const imageItem = items.find((item) => item.type.startsWith("image/"));
    if (imageItem) {
      const file = imageItem.getAsFile();
      if (file) addPendingImage(imageType, file);
    }
  }

  async function handleClickZone(imageType: "question" | "markscheme") {
    try {
      const items = await navigator.clipboard.read();
      for (const item of items) {
        const imgType = item.types.find((t) => t.startsWith("image/"));
        if (imgType) {
          const blob = await item.getType(imgType);
          const file = new File(
            [blob],
            `paste.${imgType.split("/")[1] || "png"}`,
            { type: imgType }
          );
          addPendingImage(imageType, file);
          return;
        }
      }
    } catch {
      // Clipboard API unavailable; user can use Ctrl+V instead
    }
  }

  // ── Main extraction / OCR handler ──

  async function handleExtract() {
    if (!code.trim()) {
      setStep1Error("Question code is required");
      return;
    }
    setStep1Error(null);
    setStep("processing");
    const log: string[] = [];
    const push = (msg: string) => {
      log.push(msg);
      setProcessingLog([...log]);
    };
    setProcessingError(null);

    try {
      // 1. Create question (or reuse existing if retrying after error)
      let qId = questionId;
      if (!qId) {
        push("Creating question record…");
        const createRes = await fetch("/api/questions", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            code: code.trim(),
            session: sessionVal.trim(),
            paper,
            level,
            timezone,
            curriculum: curricula,
            parts: [],
          }),
        });
        const createData = await createRes.json();
        if (!createRes.ok)
          throw new Error(createData.error ?? "Failed to create question");
        qId = createData.id as string;
        setQuestionId(qId);

        // 2. Upload pending images (only on first run)
        if (pendingImages.length > 0) {
          push(`Uploading ${pendingImages.length} image(s) to the database…`);
          await Promise.all(
            pendingImages.map(async (img) => {
              const base64 = await fileToBase64(img.file);
              await fetch("/api/questions/images/upload", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  questionId: qId,
                  imageType: img.imageType,
                  data: base64,
                  mimeType: img.file.type || "image/png",
                }),
              });
            })
          );
          push("Images saved.");
        }
      } else {
        push("Retrying with existing question record…");
      }

      // 3. OCR: question images
      const hasQ = pendingImages.some((i) => i.imageType === "question");
      const hasMS = pendingImages.some((i) => i.imageType === "markscheme");
      let qDraft = "";
      let msDraft = "";

      if (hasQ) {
        push("Extracting LaTeX from question images (OCR)…");
        const ocrRes = await fetch("/api/questions/ocr-latex", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ questionId: qId, field: "parts_draft_latex" }),
        });
        if (ocrRes.ok) {
          const d = await ocrRes.json();
          qDraft = d.latex ?? "";
        } else {
          push("⚠ Question OCR unavailable — you can enter LaTeX manually in the editor.");
        }
      }

      if (hasMS) {
        push("Extracting LaTeX from mark scheme images (OCR)…");
        const ocrRes = await fetch("/api/questions/ocr-latex", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            questionId: qId,
            field: "parts_draft_markscheme_latex",
          }),
        });
        if (ocrRes.ok) {
          const d = await ocrRes.json();
          msDraft = d.latex ?? "";
        } else {
          push("⚠ Mark scheme OCR unavailable — you can enter LaTeX manually in the editor.");
        }
      }

      setDraftLatex(qDraft);
      setDraftMsLatex(msDraft);

      // 4. Claude classification: parts, marks, command terms, subtopics
      push("Analysing question structure with Claude…");
      const detectedLabels = detectPartLabels(qDraft || msDraft);
      let claudeParts: {
        label: string;
        marks: number;
        commandTerm: string;
        subtopicCodes: string[];
      }[] = [];

      try {
        const subtopicList = availableSubtopics
          .map((s) => `${s.code}: ${s.descriptor}`)
          .join("\n");
        const claudeRes = await fetch("/api/claude", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            system: IB_CLASSIFY_SYSTEM,
            messages: [
              {
                role: "user",
                content: `Question LaTeX:\n\`\`\`\n${qDraft}\n\`\`\`\n\nMark Scheme LaTeX:\n\`\`\`\n${msDraft}\n\`\`\`\n\nAvailable subtopics:\n${subtopicList}\n\nParts detected: ${detectedLabels.join(", ") || "single whole-question part (no sub-parts)"}`,
              },
            ],
          }),
        });
        if (claudeRes.ok) {
          const data = await readJsonSafely<{ content?: { text?: string }[] }>(claudeRes);
          const text: string = data?.content?.[0]?.text ?? "";
          const jsonMatch = text.match(/\{[\s\S]*\}/);
          if (jsonMatch) {
            const parsed = JSON.parse(jsonMatch[0]);
            claudeParts = parsed.parts ?? [];
          }
        }
      } catch {
        push("⚠ Classification unavailable — metadata can be set manually.");
      }

      // 5. Split drafts using Claude-identified (or detected) labels
      const rawFinalLabels =
        claudeParts.length > 0
          ? claudeParts.map((p) => p.label)
          : detectedLabels;

      const combinedDraft = `${qDraft}\n${msDraft}`;
      const hasExplicitPartEnvironment = hasExplicitTopLevelPartStructure(combinedDraft);
      const finalLabels = hasExplicitPartEnvironment
        ? rawFinalLabels.map((l) => l.trim()).filter(Boolean)
        : [];

      if (!hasExplicitPartEnvironment && rawFinalLabels.length > 0) {
        push("No explicit top-level part labels found; using whole-question mode.");
      }

      const { stem, parts: splitQ } = splitDraftIntoParts(qDraft, finalLabels);
      const { stem: stemMs, parts: splitMS } = splitDraftIntoParts(
        msDraft,
        finalLabels
      );

      setStemLatex(stem);
      setStemMsLatex(stemMs);

      // 6. Build wizard parts
      let wizardParts: WizardPart[];
      if (finalLabels.length > 0) {
        wizardParts = finalLabels.map((label) => {
          const claude = claudeParts.find(
            (p) => p.label.toLowerCase() === label.toLowerCase()
          );
          return {
            localId: crypto.randomUUID(),
            label,
            marks: claude?.marks != null ? String(claude.marks) : "",
            commandTerm: claude?.commandTerm ?? "",
            subtopicCodes: claude?.subtopicCodes ?? [],
            contentLatex: splitQ.get(label) ?? "",
            markschemeLatex: splitMS.get(label) ?? "",
          };
        });
      } else {
        // Single whole-question part
        wizardParts = [
          {
            localId: crypto.randomUUID(),
            label: "",
            marks:
              claudeParts[0]?.marks != null
                ? String(claudeParts[0].marks)
                : "",
            commandTerm: claudeParts[0]?.commandTerm ?? "",
            subtopicCodes: claudeParts[0]?.subtopicCodes ?? [],
            contentLatex: qDraft,
            markschemeLatex: msDraft,
          },
        ];
      }

      setParts(wizardParts);
      push("Ready to review!");
      setStep("review");
    } catch (e) {
      setProcessingError(e instanceof Error ? e.message : "Unexpected error");
    }
  }

  // ── Draft apply ──

  function applyDraft(field: Field) {
    const text =
      field === "content_latex" ? draftLatex : draftMsLatex;
    const partLabels = parts.map((p) => p.label).filter(Boolean);
    const { stem, parts: splitParts } = splitDraftIntoParts(text, partLabels);

    if (field === "content_latex") {
      setStemLatex(stem);
      setParts((prev) =>
        prev.map((p) => ({
          ...p,
          contentLatex: splitParts.get(p.label) ?? p.contentLatex,
        }))
      );
    } else {
      setStemMsLatex(stem);
      setParts((prev) =>
        prev.map((p) => ({
          ...p,
          markschemeLatex: splitParts.get(p.label) ?? p.markschemeLatex,
        }))
      );
    }
  }

  // ── Part management ──

  function updatePart(localId: string, updates: Partial<WizardPart>) {
    setParts((prev) =>
      prev.map((p) => (p.localId === localId ? { ...p, ...updates } : p))
    );
  }

  function addPart() {
    setParts((prev) => [
      ...prev,
      {
        localId: crypto.randomUUID(),
        label: "",
        marks: "",
        commandTerm: "",
        subtopicCodes: [],
        contentLatex: "",
        markschemeLatex: "",
      },
    ]);
  }

  function removePart(localId: string) {
    setParts((prev) => prev.filter((p) => p.localId !== localId));
  }

  // ── Final save ──

  async function handleSave() {
    if (!questionId) return;
    setSaving(true);
    setSaveError(null);
    try {
      // Save stems
      await Promise.all([
        fetch("/api/questions/stem-update", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            questionId,
            field: "stem_latex",
            value: stemLatex,
          }),
        }),
        fetch("/api/questions/stem-update", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            questionId,
            field: "stem_markscheme_latex",
            value: stemMsLatex,
          }),
        }),
      ]);

      // Create parts sequentially to maintain order
      for (const part of parts) {
        const createRes = await fetch("/api/questions/part-metadata", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            questionId,
            partLabel: part.label,
            marks: part.marks === "" ? null : Number(part.marks),
            commandTerm: part.commandTerm || null,
            subtopicCodes: part.subtopicCodes,
          }),
        });
        if (!createRes.ok) continue;
        const { part: created } = await createRes.json();
        if (!created?.id) continue;

        await Promise.all([
          fetch("/api/questions/latex-update", {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              partId: created.id,
              field: "content_latex",
              value: part.contentLatex,
            }),
          }),
          fetch("/api/questions/latex-update", {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              partId: created.id,
              field: "markscheme_latex",
              value: part.markschemeLatex,
            }),
          }),
        ]);
      }

      onSaved();
      onClose();
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : "Unexpected error");
    } finally {
      setSaving(false);
    }
  }

  // ── Render ──────────────────────────────────────────────────────────────────

  const stepTitle =
    step === "images"
      ? "Add Question – Step 1: Images"
      : step === "processing"
      ? "Add Question – Processing…"
      : "Add Question – Step 2: Review & Edit";

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/60 overflow-y-auto py-6 px-4"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="w-full max-w-4xl bg-white rounded-2xl shadow-2xl flex flex-col">
        {/* Modal header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-blue-100 bg-blue-50 rounded-t-2xl">
          <div className="flex items-center gap-3">
            <h2 className="text-xl font-extrabold text-blue-900">{stepTitle}</h2>
            {/* Step indicator */}
            <div className="flex gap-1.5 ml-2">
              {(["images", "processing", "review"] as WizardStep[]).map(
                (s, i) => (
                  <span
                    key={s}
                    className={`w-2 h-2 rounded-full transition-colors ${
                      step === s
                        ? "bg-blue-600"
                        : i < ["images", "processing", "review"].indexOf(step)
                        ? "bg-blue-300"
                        : "bg-gray-200"
                    }`}
                  />
                )
              )}
            </div>
          </div>
          {step !== "processing" && (
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg px-3 py-1.5 text-sm font-bold text-gray-500 hover:bg-gray-100"
            >
              ✕ Close
            </button>
          )}
        </div>

        <div className="p-6 space-y-6 overflow-y-auto max-h-[85vh]">
          {/* ════════════════════════════════════════════════════════════════
              STEP 1 — Code + Images
          ═══════════════════════════════════════════════════════════════════ */}
          {step === "images" && (
            <>
              {/* Metadata */}
              <div className="rounded-xl border border-blue-200 bg-blue-50 p-4 space-y-3">
                <p className="text-sm font-bold text-blue-900">Question Metadata</p>
                <div className="flex flex-wrap gap-3">
                  <div className="flex-1 min-w-[180px]">
                    <label className="block text-xs font-bold text-blue-800 mb-1">
                      Code
                    </label>
                    <input
                      type="text"
                      value={code}
                      onChange={(e) => handleCodeChange(e.target.value)}
                      placeholder="e.g. 25M.2.AHL.TZ1.H_1"
                      className="w-full rounded border-2 border-blue-300 px-3 py-1.5 text-sm font-semibold bg-white text-blue-900 focus:ring-2 focus:ring-blue-500"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-blue-800 mb-1">
                      Session
                    </label>
                    <input
                      type="text"
                      value={sessionVal}
                      onChange={(e) => setSessionVal(e.target.value)}
                      placeholder="25M"
                      className="w-20 rounded border-2 border-blue-300 px-3 py-1.5 text-sm font-semibold bg-white text-blue-900"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-blue-800 mb-1">
                      Paper
                    </label>
                    <select
                      value={paper}
                      onChange={(e) =>
                        setPaper(Number(e.target.value) as 1 | 2 | 3)
                      }
                      className="rounded border-2 border-blue-300 px-3 py-1.5 text-sm font-semibold bg-white text-blue-900"
                    >
                      <option value={1}>P1</option>
                      <option value={2}>P2</option>
                      <option value={3}>P3</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-blue-800 mb-1">
                      Level
                    </label>
                    <select
                      value={level}
                      onChange={(e) => setLevel(e.target.value)}
                      className="rounded border-2 border-blue-300 px-3 py-1.5 text-sm font-semibold bg-white text-blue-900"
                    >
                      <option value="AHL">HL</option>
                      <option value="SL">SL</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-blue-800 mb-1">
                      Timezone
                    </label>
                    <select
                      value={timezone}
                      onChange={(e) => setTimezone(e.target.value)}
                      className="rounded border-2 border-blue-300 px-3 py-1.5 text-sm font-semibold bg-white text-blue-900"
                    >
                      <option value="TZ0">TZ0</option>
                      <option value="TZ1">TZ1</option>
                      <option value="TZ2">TZ2</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-blue-800 mb-1">
                      Curriculum
                    </label>
                    <div className="flex gap-2">
                      {(["AA", "AI"] as const).map((c) => (
                        <button
                          key={c}
                          type="button"
                          onClick={() => toggleCurriculum(c)}
                          className={`rounded border-2 px-3 py-1.5 text-sm font-bold transition-colors ${
                            curricula.includes(c)
                              ? "bg-blue-600 border-blue-600 text-white"
                              : "border-blue-300 bg-white text-blue-700 hover:bg-blue-50"
                          }`}
                        >
                          {c}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              </div>

              {step1Error && (
                <p className="text-sm text-red-600 font-medium">{step1Error}</p>
              )}

              {/* Image paste zones */}
              <div className="space-y-3">
                <p className="text-sm font-bold text-gray-700">
                  Paste Images
                  <span className="text-gray-400 font-normal ml-2 text-xs">
                    (paste question page + mark scheme page from clipboard)
                  </span>
                </p>

                {(
                  [
                    ["question", "Question", "border-blue-300 bg-blue-50/40", "text-blue-700"],
                    ["markscheme", "Mark Scheme", "border-green-300 bg-green-50/40", "text-green-700"],
                  ] as const
                ).map(([imgType, label, borderCls, labelCls]) => {
                  const imgs = pendingImages.filter(
                    (i) => i.imageType === imgType
                  );
                  return (
                    <div key={imgType}>
                      <p className={`text-xs font-bold mb-1 ${labelCls}`}>
                        {label} Images
                      </p>
                      <div
                        className={`rounded-lg border-2 border-dashed p-2 min-h-14 transition-colors cursor-pointer ${borderCls}`}
                        onPaste={(e) => handlePasteZone(e, imgType)}
                        onClick={() => handleClickZone(imgType)}
                        tabIndex={0}
                        onKeyDown={(e) =>
                          e.key === "Enter" && handleClickZone(imgType)
                        }
                        role="button"
                        aria-label={`Paste ${label} image from clipboard`}
                      >
                        {imgs.length === 0 ? (
                          <p className="text-xs text-gray-400 text-center py-1.5">
                            📋 Click or paste to add image from clipboard
                          </p>
                        ) : (
                          <div className="flex flex-wrap gap-2">
                            {imgs.map((img) => (
                              <div key={img.id} className="relative group">
                                {/* eslint-disable-next-line @next/next/no-img-element */}
                                <img
                                  src={img.objectUrl}
                                  alt="pending"
                                  className="max-h-32 rounded border border-gray-200 bg-white p-1"
                                />
                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    removePendingImage(img.id);
                                  }}
                                  className="absolute top-1 right-1 opacity-0 group-hover:opacity-100 rounded-full w-5 h-5 flex items-center justify-center bg-red-600 text-white text-xs font-bold hover:bg-red-500 transition-opacity"
                                >
                                  ×
                                </button>
                              </div>
                            ))}
                            <p className="text-xs text-gray-400 self-end pb-1">
                              📋 Click or paste to add more
                            </p>
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Actions */}
              <div className="flex justify-between items-center gap-3 pt-2 border-t border-gray-100">
                <button
                  type="button"
                  onClick={onClose}
                  className="px-4 py-2 rounded-lg text-sm font-semibold text-gray-600 hover:bg-gray-100"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleExtract}
                  disabled={!code.trim()}
                  className="px-6 py-2 rounded-lg bg-blue-600 text-white text-sm font-bold hover:bg-blue-700 disabled:opacity-40 flex items-center gap-2"
                >
                  Save Images &amp; Extract with OCR →
                </button>
              </div>
            </>
          )}

          {/* ════════════════════════════════════════════════════════════════
              PROCESSING
          ═══════════════════════════════════════════════════════════════════ */}
          {step === "processing" && (
            <div className="space-y-4 py-4">
              <div className="flex items-center gap-3">
                {!processingError && (
                  <span className="inline-block w-5 h-5 border-2 border-blue-300 border-t-blue-600 rounded-full animate-spin" />
                )}
                <span className="text-sm font-semibold text-gray-700">
                  {processingError ? "Processing failed" : "Processing…"}
                </span>
              </div>

              <ul className="space-y-1.5">
                {processingLog.map((msg, i) => (
                  <li
                    key={i}
                    className="text-sm text-gray-600 flex items-start gap-2"
                  >
                    <span className="text-green-500 mt-0.5 shrink-0">✓</span>
                    {msg}
                  </li>
                ))}
              </ul>

              {processingError && (
                <div className="rounded-lg bg-red-50 border border-red-200 px-4 py-3 space-y-2">
                  <p className="text-sm font-semibold text-red-700">
                    Error: {processingError}
                  </p>
                  <button
                    onClick={() => {
                      setStep("images");
                      setProcessingLog([]);
                      setProcessingError(null);
                    }}
                    className="text-xs text-red-600 underline hover:no-underline"
                  >
                    ← Go back and try again
                  </button>
                </div>
              )}
            </div>
          )}

          {/* ════════════════════════════════════════════════════════════════
              STEP 2 — Review & Edit
          ═══════════════════════════════════════════════════════════════════ */}
          {step === "review" && (
            <>
              {/* Q / MS toggle */}
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setActiveField("content_latex")}
                  className={`rounded-lg px-4 py-1.5 text-sm font-bold border-2 transition-colors ${
                    activeField === "content_latex"
                      ? "bg-blue-600 border-blue-600 text-white"
                      : "border-blue-300 text-blue-700 bg-white hover:bg-blue-50"
                  }`}
                >
                  Question
                </button>
                <button
                  type="button"
                  onClick={() => setActiveField("markscheme_latex")}
                  className={`rounded-lg px-4 py-1.5 text-sm font-bold border-2 transition-colors ${
                    activeField === "markscheme_latex"
                      ? "bg-green-600 border-green-600 text-white"
                      : "border-green-300 text-green-700 bg-white hover:bg-green-50"
                  }`}
                >
                  Mark Scheme
                </button>
              </div>

              {/* Extracted draft panel */}
              <div className="border border-amber-200 rounded-lg overflow-hidden bg-amber-50/30">
                <div className="flex items-center gap-2 px-4 py-2 bg-amber-50 border-b border-amber-200">
                  <span className="font-semibold text-sm text-amber-800">
                    Extracted draft
                    <span className="text-amber-500 font-normal ml-1 text-xs">
                      (review or edit the raw OCR output, then apply)
                    </span>
                  </span>
                </div>
                <div className="p-3 space-y-2">
                  <textarea
                    className="w-full border border-amber-200 rounded-md p-2 font-mono text-xs resize-y min-h-24 bg-white text-gray-900 focus:outline-none focus:ring-2 focus:ring-amber-400"
                    value={
                      activeField === "content_latex" ? draftLatex : draftMsLatex
                    }
                    onChange={(e) =>
                      activeField === "content_latex"
                        ? setDraftLatex(e.target.value)
                        : setDraftMsLatex(e.target.value)
                    }
                    placeholder="Raw OCR output will appear here. You can edit it, then click Apply to editors."
                  />
                  <button
                    onClick={() => applyDraft(activeField)}
                    className="px-3 py-1 bg-green-600 text-white rounded text-xs font-medium hover:bg-green-700"
                  >
                    ↓ Apply to editors
                  </button>
                </div>
              </div>

              {/* Stem editor */}
              <WizardStemEditor
                stemLatex={stemLatex}
                stemMsLatex={stemMsLatex}
                activeField={activeField}
                onSave={(field, value) => {
                  if (field === "stem_latex") setStemLatex(value);
                  else setStemMsLatex(value);
                }}
              />

              {/* Part editors */}
              <div className="space-y-3">
                <div className="flex items-center gap-2">
                  <p className="text-sm font-bold text-gray-700">Parts</p>
                  {parts.length > 0 && (
                    <span className="text-xs text-gray-400">
                      ({parts.length} part{parts.length !== 1 ? "s" : ""} — Claude-suggested marks &amp; subtopics pre-filled)
                    </span>
                  )}
                </div>

                {parts.map((part, idx) => (
                  <WizardPartEditor
                    key={part.localId}
                    part={part}
                    activeField={activeField}
                    index={idx}
                    availableSubtopics={availableSubtopics}
                    onSaveLatex={(contentLatex, markschemeLatex) =>
                      updatePart(part.localId, { contentLatex, markschemeLatex })
                    }
                    onMeta={(label, marks, commandTerm, subtopicCodes) =>
                      updatePart(part.localId, {
                        label,
                        marks,
                        commandTerm,
                        subtopicCodes,
                      })
                    }
                    onRemove={() => removePart(part.localId)}
                  />
                ))}

                <button
                  type="button"
                  onClick={addPart}
                  className="w-full rounded-lg border-2 border-dashed border-gray-300 py-2 text-sm text-gray-500 hover:border-blue-300 hover:text-blue-600 transition-colors"
                >
                  + Add Part
                </button>
              </div>

              {saveError && (
                <p className="text-sm text-red-600 font-medium">{saveError}</p>
              )}

              {/* Bottom action bar */}
              <div className="flex justify-between items-center gap-3 pt-2 border-t border-gray-100">
                <p className="text-xs text-gray-400">
                  Images are already saved. Closing without saving will leave an empty question record.
                </p>
                <button
                  type="button"
                  onClick={handleSave}
                  disabled={saving}
                  className="px-6 py-2 rounded-lg bg-emerald-600 text-white text-sm font-bold hover:bg-emerald-700 disabled:opacity-40 shrink-0"
                >
                  {saving ? "Saving…" : "Save Question →"}
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
