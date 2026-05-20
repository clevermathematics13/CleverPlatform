"use client";

import type { TestQueueItem, ExamConfig, SavedExam, Course } from "./types";

const ALL_TEMPLATES = [
  { curriculum: "AA", level: "HL", paper: 1 },
  { curriculum: "AA", level: "HL", paper: 2 },
  { curriculum: "AA", level: "HL", paper: 3 },
  { curriculum: "AA", level: "SL", paper: 1 },
  { curriculum: "AA", level: "SL", paper: 2 },
  { curriculum: "AI", level: "HL", paper: 1 },
  { curriculum: "AI", level: "HL", paper: 2 },
  { curriculum: "AI", level: "HL", paper: 3 },
  { curriculum: "AI", level: "SL", paper: 1 },
  { curriculum: "AI", level: "SL", paper: 2 },
];

function QueueRow({
  item,
  number,
  showSection,
  minutesPerMark,
  onOpenQuestion,
  onRemove,
  onUpdateSection,
  onMoveUp,
}: {
  item: TestQueueItem;
  number: number;
  showSection: boolean;
  minutesPerMark: number;
  onOpenQuestion: () => void;
  onRemove: () => void;
  onUpdateSection: (section: "A" | "B") => void;
  onMoveUp: () => void;
}) {
  return (
    <div
      className="flex items-center gap-1 rounded bg-white border border-indigo-200 px-2 py-1 text-xs hover:border-indigo-400 cursor-pointer"
      onClick={onOpenQuestion}
      title="Open this question in the editor"
    >
      {/* Move up */}
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); onMoveUp(); }}
        disabled={number === 1}
        title="Move up"
        className="text-indigo-400 hover:text-indigo-700 disabled:opacity-20 flex-shrink-0 leading-none"
      >
        ▲
      </button>
      {/* Number */}
      <span className="font-bold text-indigo-700 w-5 text-right flex-shrink-0">
        {number}.
      </span>
      {/* Code + marks/minutes + section label */}
      <div className="flex-1 min-w-0 flex flex-col gap-0">
        <div className="flex items-center gap-2 min-w-0">
          <span className="flex-1 text-left font-semibold text-gray-800 truncate">
            {item.code}
          </span>
          <span className="text-xs text-indigo-500 font-semibold flex-shrink-0">
            {item.marks} marks / {(item.marks * minutesPerMark).toFixed(2)} minutes
          </span>
        </div>
        {(item.partSubtopics?.length ?? 0) > 0 ? (
          <div className="flex flex-col">
            {item.partSubtopics.map((ps, i) => (
              <span key={i} className="text-[10px] text-gray-400 leading-tight truncate">
                {ps.partLabel ? `part ${ps.partLabel.toLowerCase()} · ` : ""}{ps.codes.join(" · ")}
              </span>
            ))}
          </div>
        ) : item.subtopicCodes && item.subtopicCodes.length > 0 ? (
          <span className="text-[10px] text-gray-400 leading-tight truncate">
            {item.subtopicCodes.join(" · ")}
          </span>
        ) : null}
      </div>
      {/* Section toggle (P1/P2 AA only) */}
      {showSection && (
        <div className="flex gap-0.5 flex-shrink-0">
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); onUpdateSection("A"); }}
            className={`rounded px-1 py-0.5 text-xs font-bold ${
              item.section === "A"
                ? "bg-blue-600 text-white"
                : "bg-gray-100 text-gray-500 hover:bg-blue-100"
            }`}
          >
            A
          </button>
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); onUpdateSection("B"); }}
            className={`rounded px-1 py-0.5 text-xs font-bold ${
              item.section === "B"
                ? "bg-orange-500 text-white"
                : "bg-gray-100 text-gray-500 hover:bg-orange-100"
            }`}
          >
            B
          </button>
        </div>
      )}
      {/* Remove */}
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); onRemove(); }}
        className="text-gray-400 hover:text-red-600 font-bold ml-0.5 flex-shrink-0"
      >
        ×
      </button>
    </div>
  );
}

export function TestBuilderPanel({
  queue,
  examConfig,
  courses,
  showSections,
  queueHasMarkscheme,
  showTemplateEditor,
  templateEdits,
  onConfigChange,
  onRemove,
  onUpdateSection,
  onAutoSort,
  onMoveUp,
  onPreviewTest,
  onPreviewMS,
  onClear,
  onToggleTemplateEditor,
  onTemplateEditChange,
  onSaveTemplates,
  savedExams,
  showSavedExams,
  savingExam,
  loadingExams,
  activeExamId,
  examDirty,
  saveExamError,
  onClearSaveExamError,
  onSaveExam,
  onToggleSavedExams,
  onLoadExam,
  onDeleteExam,
  showRandomPanel,
  randomTargetMinutes,
  buildingRandom,
  randomError,
  courseIdError,
  onToggleRandomPanel,
  onRandomTargetChange,
  onBuildRandom,
  onClearCourseIdError,
  onOpenQuestionFromQueue,
  savingToGradebook,
  onSaveToGradebook,
}: {
  queue: TestQueueItem[];
  examConfig: ExamConfig;
  courses: Course[];
  showSections: boolean;
  queueHasMarkscheme: boolean;
  showTemplateEditor: boolean;
  templateEdits: Record<string, string>;
  onConfigChange: (updates: Partial<ExamConfig>) => void;
  onRemove: (id: string) => void;
  onUpdateSection: (id: string, section: "A" | "B") => void;
  onAutoSort: () => void;
  onMoveUp: (index: number) => void;
  onPreviewTest: () => void;
  onPreviewMS: () => void;
  onClear: () => void;
  onToggleTemplateEditor: () => void;
  onTemplateEditChange: (key: string, val: string) => void;
  onSaveTemplates: () => void;
  savedExams: SavedExam[];
  showSavedExams: boolean;
  savingExam: boolean;
  loadingExams: boolean;
  activeExamId: string | null;
  examDirty: boolean;
  saveExamError: string | null;
  onClearSaveExamError: () => void;
  onSaveExam: () => void;
  onToggleSavedExams: () => void;
  onLoadExam: (exam: SavedExam) => void;
  onDeleteExam: (id: string) => void;
  showRandomPanel: boolean;
  randomTargetMinutes: number;
  buildingRandom: boolean;
  randomError: string | null;
  courseIdError: boolean;
  onToggleRandomPanel: () => void;
  onRandomTargetChange: (minutes: number) => void;
  onBuildRandom: () => void;
  onClearCourseIdError: () => void;
  onOpenQuestionFromQueue: (item: TestQueueItem) => void;
  savingToGradebook: boolean;
  onSaveToGradebook: () => void;
}) {
  // Build section groups for rendering placeholder dividers
  const sectionAItems = showSections ? queue.filter((q) => q.section === "A") : [];
  const sectionBItems = showSections ? queue.filter((q) => q.section === "B") : [];
  const unsectionedItems = showSections
    ? queue.filter((q) => q.section !== "A" && q.section !== "B")
    : [];

  const canPreview = queue.length > 0 && examConfig.courseId;
  const totalMarks = queue.reduce((sum, item) => sum + item.marks, 0);
  // HL: 120 min / 110 marks = 12/11; SL: 90 min / 80 marks = 9/8
  const mpm = examConfig.level === "HL" ? 12 / 11 : 9 / 8;
  const totalMinutes = Math.ceil(mpm * totalMarks);

  return (
    <div
      className="flex-shrink-0 rounded-xl border-2 border-indigo-300 bg-indigo-50 flex flex-col transition-[width] duration-200"
      style={{
        width: "var(--exam-builder-width, 20rem)",
        position: "sticky",
        top: 20,
        maxHeight: "calc(100vh - 40px)",
        overflow: "hidden",
      }}
    >
      {/* Header */}
      <div className="px-4 pt-4 pb-2 border-b border-indigo-200">
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-bold text-indigo-900 text-base">🏗 ExamBuilder</h3>
          <span className="text-xs font-semibold text-indigo-600">
            {queue.length} question{queue.length !== 1 ? "s" : ""}
          </span>
        </div>
        {queue.length > 0 && (
          <div className="flex items-center justify-between rounded-lg bg-indigo-100 border border-indigo-200 px-3 py-1.5 mb-2">
            <span className="text-xs font-bold text-indigo-800">
              {totalMarks} mark{totalMarks !== 1 ? "s" : ""}
            </span>
            <span className="text-xs font-semibold text-indigo-600">
              ≈ {totalMinutes} min
            </span>
          </div>
        )}
      </div>
      <div className="flex-1 overflow-y-auto">
        <div className="px-4 pt-3 pb-2 border-b border-indigo-100" suppressHydrationWarning>
        {/* Exam config form */}
        <div className="space-y-2" suppressHydrationWarning>
          <input
            type="text"
            value={examConfig.name}
            onChange={(e) => onConfigChange({ name: e.target.value })}
            placeholder="Exam name (e.g. Mock 2026)"
            className="w-full rounded border border-indigo-300 px-2 py-1 text-sm font-semibold text-indigo-900 bg-white placeholder:text-indigo-300"
            suppressHydrationWarning
          />
          <div className="flex gap-2">
            <select
              value={examConfig.curriculum}
              onChange={(e) => onConfigChange({ curriculum: e.target.value as "AA" | "AI" })}
              className="flex-1 rounded border border-indigo-300 px-2 py-1 text-xs font-bold text-indigo-900 bg-white"
              suppressHydrationWarning
            >
              <option value="AA">AA</option>
              <option value="AI">AI</option>
            </select>
            <select
              value={examConfig.level}
              onChange={(e) => onConfigChange({ level: e.target.value as "HL" | "SL" })}
              className="flex-1 rounded border border-indigo-300 px-2 py-1 text-xs font-bold text-indigo-900 bg-white"
              suppressHydrationWarning
            >
              <option value="HL">HL</option>
              <option value="SL">SL</option>
            </select>
            <select
              value={examConfig.paper}
              onChange={(e) => onConfigChange({ paper: parseInt(e.target.value) as 1 | 2 | 3 })}
              className="flex-1 rounded border border-indigo-300 px-2 py-1 text-xs font-bold text-indigo-900 bg-white"
              suppressHydrationWarning
            >
              <option value={1}>P1</option>
              <option value={2}>P2</option>
              <option value={3}>P3</option>
            </select>
          </div>
          <select
            value={examConfig.courseId}
            onChange={(e) => {
              onConfigChange({ courseId: e.target.value });
              if (e.target.value) onClearCourseIdError();
            }}
            className={`w-full rounded border px-2 py-1 text-xs font-bold text-indigo-900 bg-white transition-colors ${
              courseIdError
                ? "border-2 border-red-500 ring-1 ring-red-400"
                : "border-indigo-300"
            }`}
            suppressHydrationWarning
          >
            <option value="">— Select class —</option>
            {courses.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
          <input
            type="date"
            value={examConfig.date}
            onChange={(e) => onConfigChange({ date: e.target.value })}
            className="w-full rounded border border-indigo-300 px-2 py-1 text-xs font-semibold text-indigo-900 bg-white"
            suppressHydrationWarning
          />
        </div>

        {/* Section controls (P1/P2 AA only) */}
        {showSections && queue.length > 0 && (
          <button
            type="button"
            onClick={onAutoSort}
            className="mt-2 w-full rounded border border-indigo-400 bg-white text-xs font-bold text-indigo-700 px-2 py-1 hover:bg-indigo-100"
          >
            ⇅ Sort: All Section A then Section B
          </button>
        )}

        {/* Random Exam button */}
        <button
          type="button"
          onClick={onToggleRandomPanel}
          className={`mt-2 w-full rounded border-2 text-xs font-bold px-2 py-1.5 transition-colors ${
            showRandomPanel
              ? "bg-violet-600 border-violet-600 text-white"
              : "border-violet-400 text-violet-700 bg-white hover:bg-violet-50"
          }`}
        >
          🎲 Random Exam
        </button>

        {/* Random exam panel */}
        {showRandomPanel && (
          <div className="mt-2 rounded-lg border border-violet-300 bg-violet-50 p-3 space-y-2">
            <p className="text-xs font-bold text-violet-900">
              Build a random exam within covered syllabus
            </p>

            {courseIdError && (
              <p className="text-xs font-semibold text-red-600">
                ↑ Please select a class first
              </p>
            )}

            <div>
              <label className="text-xs font-semibold text-violet-800 block mb-0.5">
                Target duration (minutes)
              </label>
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  min={30}
                  max={300}
                  step={5}
                  value={randomTargetMinutes}
                  onChange={(e) => onRandomTargetChange(parseInt(e.target.value) || 120)}
                  className="w-20 rounded border border-violet-300 px-2 py-1 text-sm font-bold text-violet-900 bg-white"
                />
                <span className="text-xs text-violet-600">
                  ≈ {Math.floor((randomTargetMinutes * 11) / 12)} marks
                </span>
              </div>
            </div>

            {randomError && (
              <p className="text-xs text-red-600 font-medium">{randomError}</p>
            )}

            <button
              type="button"
              onClick={onBuildRandom}
              disabled={buildingRandom}
              className="w-full rounded bg-violet-600 text-white text-xs font-bold py-1.5 hover:bg-violet-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {buildingRandom ? "Building…" : "🎲 Build Exam"}
            </button>
          </div>
        )}
        </div>
        <div className="px-2 py-2 space-y-1">
        {queue.length === 0 && (
          <p className="text-center text-xs text-indigo-400 py-6">
            Click + next to a question to add it here
          </p>
        )}

        {showSections ? (
          <>
            {/* Section A group */}
            {sectionAItems.length > 0 && (
              <>
                <div className="px-2 py-1 text-xs font-bold text-blue-700 bg-blue-50 rounded border border-blue-200">
                  Section A ({sectionAItems.length})
                </div>
                {/* TODO: Section A header image placeholder */}
                <div className="px-2 py-1 text-xs text-gray-400 italic border border-dashed border-gray-300 rounded text-center">
                  [ Section A header image — coming soon ]
                </div>
                {sectionAItems.map((item, globalIdx) => {
                  const idx = queue.indexOf(item);
                  return (
                    <QueueRow
                      key={item.id}
                      item={item}
                      number={globalIdx + 1}
                      showSection={true}
                      minutesPerMark={mpm}
                      onOpenQuestion={() => onOpenQuestionFromQueue(item)}
                      onRemove={() => onRemove(item.id)}
                      onUpdateSection={(s) => onUpdateSection(item.id, s)}
                      onMoveUp={() => onMoveUp(idx)}
                    />
                  );
                })}
              </>
            )}

            {/* Section B group */}
            {sectionBItems.length > 0 && (
              <>
                <div className="px-2 py-1 text-xs font-bold text-orange-700 bg-orange-50 rounded border border-orange-200 mt-1">
                  Section B ({sectionBItems.length})
                </div>
                {/* TODO: Section B header image placeholder */}
                <div className="px-2 py-1 text-xs text-gray-400 italic border border-dashed border-gray-300 rounded text-center">
                  [ Section B header image — coming soon ]
                </div>
                {sectionBItems.map((item, bIdx) => {
                  const idx = queue.indexOf(item);
                  return (
                    <QueueRow
                      key={item.id}
                      item={item}
                      number={sectionAItems.length + bIdx + 1}
                      showSection={true}
                      minutesPerMark={mpm}
                      onOpenQuestion={() => onOpenQuestionFromQueue(item)}
                      onRemove={() => onRemove(item.id)}
                      onUpdateSection={(s) => onUpdateSection(item.id, s)}
                      onMoveUp={() => onMoveUp(idx)}
                    />
                  );
                })}
              </>
            )}

            {/* Unsectioned */}
            {unsectionedItems.map((item, uIdx) => {
              const idx = queue.indexOf(item);
              return (
                <QueueRow
                  key={item.id}
                  item={item}
                  number={sectionAItems.length + sectionBItems.length + uIdx + 1}
                  showSection={true}
                  minutesPerMark={mpm}
                  onOpenQuestion={() => onOpenQuestionFromQueue(item)}
                  onRemove={() => onRemove(item.id)}
                  onUpdateSection={(s) => onUpdateSection(item.id, s)}
                  onMoveUp={() => onMoveUp(idx)}
                />
              );
            })}
          </>
        ) : (
          queue.map((item, idx) => (
            <QueueRow
              key={item.id}
              item={item}
              number={idx + 1}
              showSection={false}
              minutesPerMark={mpm}
              onOpenQuestion={() => onOpenQuestionFromQueue(item)}
              onRemove={() => onRemove(item.id)}
              onUpdateSection={(s) => onUpdateSection(item.id, s)}
              onMoveUp={() => onMoveUp(idx)}
            />
          ))
        )}
        </div>
      </div>

      {/* Footer */}
      <div className="px-4 py-3 border-t border-indigo-200 space-y-2">
        <div className="flex gap-2">
          <button
            type="button"
            onClick={onPreviewTest}
            disabled={!canPreview}
            className="flex-1 rounded-lg bg-indigo-600 text-white font-bold text-sm py-2 hover:bg-indigo-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            🖨 Preview Exam
          </button>
          <button
            type="button"
            onClick={onPreviewMS}
            disabled={!canPreview || !queueHasMarkscheme}
            className="flex-1 rounded-lg border-2 border-indigo-400 text-indigo-700 font-bold text-sm py-1.5 hover:bg-indigo-100 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            title={!queueHasMarkscheme ? "No markscheme images in queue" : undefined}
          >
            📝 Mark Scheme
          </button>
        </div>

        {/* Save error — selectable so user can copy */}
        {saveExamError && (
          <div className="rounded border border-red-300 bg-red-50 px-2 py-1.5">
            <div className="flex items-center justify-between mb-1">
              <span className="text-xs font-bold text-red-700">Save failed</span>
              <button type="button" onClick={onClearSaveExamError} className="text-red-400 hover:text-red-700 text-xs font-bold leading-none">✕</button>
            </div>
            <pre className="text-xs text-red-800 whitespace-pre-wrap break-all select-text cursor-text font-mono">{saveExamError}</pre>
          </div>
        )}

        {/* Save / Load row */}
        {activeExamId && examDirty && (
          <p className="text-xs font-semibold text-amber-700 flex items-center gap-1">
            <span className="inline-block h-2 w-2 rounded-full bg-amber-500 animate-pulse" />
            Unsaved changes
          </p>
        )}
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => onSaveExam()}
            disabled={savingExam || queue.length === 0}
            className={`flex-1 rounded text-white text-xs font-bold py-1.5 disabled:opacity-40 disabled:cursor-not-allowed transition-colors ${
              activeExamId && examDirty
                ? "bg-amber-500 hover:bg-amber-600 animate-pulse"
                : "bg-green-600 hover:bg-green-700"
            }`}
            title={activeExamId ? "Overwrite saved exam" : "Save exam to database"}
          >
            {savingExam ? "Saving…" : activeExamId ? "💾 Overwrite" : "💾 Save Exam"}
          </button>
          <button
            type="button"
            onClick={onToggleSavedExams}
            className={`flex-1 rounded text-xs font-bold py-1.5 transition-colors border ${
              showSavedExams
                ? "bg-amber-100 border-amber-400 text-amber-800 hover:bg-amber-200"
                : "border-gray-300 text-gray-600 bg-white hover:bg-gray-100"
            }`}
          >
            📂 {showSavedExams ? "Hide" : "Load Exam"}
          </button>
        </div>

        {/* Save to Gradebook */}
        <button
          type="button"
          onClick={onSaveToGradebook}
          disabled={savingToGradebook || queue.length === 0 || !examConfig.courseId || !examConfig.name}
          className="w-full rounded text-xs font-bold py-1.5 transition-colors bg-teal-600 text-white hover:bg-teal-700 disabled:opacity-40 disabled:cursor-not-allowed"
          title={!examConfig.courseId ? "Select a course first" : !examConfig.name ? "Enter an exam name first" : "Create a test in the gradebook from this exam"}
        >
          {savingToGradebook ? "Saving…" : "📊 Save to Gradebook"}
        </button>

        {/* Saved exams list */}
        {showSavedExams && (
          <div className="rounded border border-amber-200 bg-amber-50 p-2 space-y-1 max-h-48 overflow-y-auto">
            <p className="text-xs font-bold text-amber-800 mb-1">Saved Exams</p>
            {loadingExams && <p className="text-xs text-gray-500">Loading…</p>}
            {!loadingExams && savedExams.length === 0 && (
              <p className="text-xs text-gray-500">No saved exams yet.</p>
            )}
            {savedExams.map((exam) => (
              <div
                key={exam.id}
                onClick={() => onLoadExam(exam)}
                className={`flex items-center gap-1 rounded px-2 py-1 border cursor-pointer ${
                  activeExamId === exam.id
                    ? "border-green-400 bg-green-50 hover:bg-green-100"
                    : "border-gray-200 bg-white hover:bg-indigo-50 hover:border-indigo-300"
                }`}
              >
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-semibold text-gray-800 truncate">{exam.name}</p>
                  <p className="text-xs text-gray-500">
                    {exam.curriculum}{exam.level} P{exam.paper} · {exam.questions.length}q
                    {exam.exam_date ? ` · ${exam.exam_date}` : ""}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={(e) => { e.stopPropagation(); onDeleteExam(exam.id); }}
                  className="text-gray-400 hover:text-red-600 font-bold ml-0.5 flex-shrink-0"
                >
                  ×
                </button>
              </div>
            ))}
          </div>
        )}

        <div className="flex gap-2">
          <button
            type="button"
            onClick={onClear}
            disabled={queue.length === 0}
            className="flex-1 rounded border border-gray-300 text-xs font-bold text-gray-600 py-1 hover:bg-gray-100 disabled:opacity-40"
          >
            Clear all
          </button>
          <button
            type="button"
            onClick={onToggleTemplateEditor}
            className="flex-1 rounded border border-gray-300 text-xs font-bold text-gray-600 py-1 hover:bg-gray-100"
          >
            ⚙ Templates
          </button>
        </div>

        {/* Inline template editor */}
        {showTemplateEditor && (
          <div className="rounded border border-gray-200 bg-white p-2 space-y-1">
            <p className="text-xs font-bold text-gray-700 mb-1">Cover Slide Presentation IDs</p>
            {ALL_TEMPLATES.map(({ curriculum, level, paper }) => {
              const key = `${curriculum}-${level}-${paper}`;
              return (
                <div key={key} className="flex items-center gap-1">
                  <span className="text-xs font-semibold text-gray-600 w-16 flex-shrink-0">
                    {curriculum}{level} P{paper}
                  </span>
                  <input
                    type="text"
                    value={templateEdits[key] ?? ""}
                    onChange={(e) => onTemplateEditChange(key, e.target.value)}
                    placeholder="Presentation ID"
                    className="flex-1 rounded border border-gray-300 px-1.5 py-0.5 text-xs font-mono"
                  />
                </div>
              );
            })}
            <button
              type="button"
              onClick={onSaveTemplates}
              className="w-full mt-1 rounded bg-green-600 text-white text-xs font-bold py-1 hover:bg-green-700"
            >
              Save Templates
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
