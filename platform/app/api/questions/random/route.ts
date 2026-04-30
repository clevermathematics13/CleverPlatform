import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

interface QuestionPart {
  id: string;
  part_label: string;
  marks: number;
  subtopic_codes: string[];
  command_term: string | null;
  sort_order: number;
}

interface CandidateQuestion {
  id: string;
  code: string;
  section: "A" | "B" | null;
  curriculum: string[];
  has_question_images: boolean;
  has_markscheme_images: boolean;
  marks: number;
  primarySection: number;    // topic section (1-5) this question belongs to
  subtopicCodes: string[];   // all subtopic codes across its parts
  commandTerms: string[];    // all command terms across its parts
}

// Shuffle an array in-place (Fisher-Yates)
function shuffle<T>(arr: T[]): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

// Determine the dominant topic section (1-5) for a question
// based on which subtopic codes appear most in its parts
function primarySectionFor(
  subtopicCodes: string[],
  subtopicSectionMap: Record<string, number>
): number {
  const counts: Record<number, number> = {};
  for (const code of subtopicCodes) {
    const sec = subtopicSectionMap[code];
    if (sec) counts[sec] = (counts[sec] ?? 0) + 1;
  }
  let best = 0;
  let bestCount = 0;
  for (const [sec, count] of Object.entries(counts)) {
    if (count > bestCount) {
      bestCount = count;
      best = parseInt(sec);
    }
  }
  return best;
}

// POST /api/questions/random
// Body: { courseId: string, paper: number, targetMinutes: number }
// Returns: { questions: TestQueueItem[] }
export async function POST(request: NextRequest) {
  const supabase = await createClient();

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single();
  if (!profile || profile.role !== "teacher") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = await request.json() as {
    courseId: string;
    paper: number;
    targetMinutes: number;
  };
  const { courseId, paper, targetMinutes } = body;

  if (!courseId || !paper || !targetMinutes) {
    return NextResponse.json({ error: "courseId, paper, and targetMinutes are required" }, { status: 400 });
  }

  // 1. Get covered subtopics for this course
  const { data: coverage } = await supabase
    .from("syllabus_coverage")
    .select("subtopic_code")
    .eq("course_id", courseId)
    .eq("covered", true);

  const coveredCodes = (coverage ?? []).map((r) => r.subtopic_code);
  if (coveredCodes.length === 0) {
    return NextResponse.json({ error: "No subtopics marked as covered for this class. Set up the syllabus first." }, { status: 422 });
  }

  // 2. Get subtopic→section map so we can determine topic groups
  const { data: allSubtopics } = await supabase
    .from("subtopics")
    .select("code, section");

  const subtopicSectionMap: Record<string, number> = {};
  for (const s of allSubtopics ?? []) {
    subtopicSectionMap[s.code] = s.section;
  }

  // Which topic sections (1-5) are covered?
  const coveredSections = new Set(
    coveredCodes.map((c) => subtopicSectionMap[c]).filter(Boolean)
  );

  // 3. Find question IDs whose parts overlap covered subtopics.
  // Fetch in batches of 200 subtopic codes to avoid URL length limits.
  const BATCH = 200;
  const allMatchingPartIds = new Set<string>();
  for (let i = 0; i < coveredCodes.length; i += BATCH) {
    const batch = coveredCodes.slice(i, i + BATCH);
    const { data: batchParts } = await supabase
      .from("question_parts")
      .select("question_id")
      .overlaps("subtopic_codes", batch);
    for (const p of batchParts ?? []) allMatchingPartIds.add(p.question_id);
  }

  if (allMatchingPartIds.size === 0) {
    return NextResponse.json({ error: "No questions found matching covered subtopics." }, { status: 422 });
  }

  const matchingQuestionIds = [...allMatchingPartIds];

  // 4. Fetch those questions — batch the .in() to avoid PostgREST URL limits.
  // Filter: AHL level, matching paper. Don't filter on curriculum because
  // the curriculum column may be NULL for older rows (ALTER TABLE default
  // only applies to rows inserted after the migration).
  const ID_BATCH = 150;
  const rawQuestions: Array<{
    id: string;
    code: string;
    section: string | null;
    curriculum: string[] | null;
    question_parts: QuestionPart[];
  }> = [];

  for (let i = 0; i < matchingQuestionIds.length; i += ID_BATCH) {
    const batch = matchingQuestionIds.slice(i, i + ID_BATCH);
    const { data: batchQs } = await supabase
      .from("ib_questions")
      .select(
        "id, code, section, curriculum, question_parts(id, part_label, marks, subtopic_codes, command_term, sort_order)"
      )
      .in("id", batch)
      .eq("paper", paper)
      .eq("level", "AHL");
    for (const q of batchQs ?? []) rawQuestions.push(q);
  }

  if (rawQuestions.length === 0) {
    return NextResponse.json({
      error: `No AAHL Paper ${paper} questions found matching covered subtopics. Try a different paper, or mark more subtopics as covered.`,
    }, { status: 422 });
  }

  // Build candidate list with image availability (check question_images table, batched)
  const questionIds = rawQuestions.map((q) => q.id);
  const hasQuestionImg = new Set<string>();
  const hasMSImg = new Set<string>();
  for (let i = 0; i < questionIds.length; i += ID_BATCH) {
    const batch = questionIds.slice(i, i + ID_BATCH);
    const { data: imageRows } = await supabase
      .from("question_images")
      .select("question_id, image_type")
      .in("question_id", batch);
    for (const row of imageRows ?? []) {
      if (row.image_type === "question") hasQuestionImg.add(row.question_id);
      if (row.image_type === "markscheme") hasMSImg.add(row.question_id);
    }
  }

  // Build candidate objects
  const candidates: CandidateQuestion[] = rawQuestions.map((q) => {
    const parts = (q.question_parts as QuestionPart[]).sort((a, b) => a.sort_order - b.sort_order);
    const allSubtopicCodes = [...new Set(parts.flatMap((p) => p.subtopic_codes ?? []))];
    const allCommandTerms = [...new Set(parts.map((p) => p.command_term).filter(Boolean) as string[])];
    const marks = parts.reduce((sum, p) => sum + p.marks, 0);

    // Only count covered subtopics when determining primary section
    const coveredSet = new Set(coveredCodes);
    const coveredSubtopicsOfQ = allSubtopicCodes.filter((c) => coveredSet.has(c));

    return {
      id: q.id,
      code: q.code,
      section: q.section as "A" | "B" | null,
      curriculum: q.curriculum ?? ["AA"],
      has_question_images: hasQuestionImg.has(q.id),
      has_markscheme_images: hasMSImg.has(q.id),
      marks,
      primarySection: primarySectionFor(coveredSubtopicsOfQ, subtopicSectionMap),
      subtopicCodes: allSubtopicCodes,
      commandTerms: allCommandTerms,
    };
  });

  // 5. Run selection algorithm
  const targetMarks = Math.floor((targetMinutes * 11) / 12);
  const halfTarget = targetMarks / 2;

  // Separate into A and B pools, shuffle both
  const poolA = shuffle(candidates.filter((q) => q.section === "A"));
  const poolB = shuffle(candidates.filter((q) => q.section === "B"));
  // Questions with unknown section get split evenly (fallback)
  const poolUnknown = shuffle(candidates.filter((q) => !q.section));

  // Group by covered section
  const bySection = (pool: CandidateQuestion[]) => {
    const map: Record<number, CandidateQuestion[]> = {};
    for (const q of pool) {
      if (!map[q.primarySection]) map[q.primarySection] = [];
      map[q.primarySection].push(q);
    }
    return map;
  };

  const sectionPoolsA = bySection(poolA);
  const sectionPoolsB = bySection(poolB);

  const selected: CandidateQuestion[] = [];
  let marksA = 0;
  let marksB = 0;
  const usedIds = new Set<string>();
  const usedSubtopics = new Set<string>();

  // Scoring: prefer questions with fewest already-used subtopics
  const noveltyScore = (q: CandidateQuestion): number => {
    const novel = q.subtopicCodes.filter((c) => !usedSubtopics.has(c)).length;
    return novel;
  };

  const pick = (
    pool: CandidateQuestion[],
    fromSections?: number[]
  ): CandidateQuestion | null => {
    const available = pool.filter((q) => !usedIds.has(q.id));
    let candidates = fromSections
      ? available.filter((q) => fromSections.includes(q.primarySection))
      : available;

    if (candidates.length === 0) candidates = available;
    if (candidates.length === 0) return null;

    // Sort by novelty (most new subtopics first), then by command term diversity
    candidates = [...candidates].sort((a, b) => {
      const novelDiff = noveltyScore(b) - noveltyScore(a);
      if (novelDiff !== 0) return novelDiff;
      // Fallback: prefer questions where command terms aren't already heavily used
      return b.commandTerms.length - a.commandTerms.length;
    });

    return candidates[0];
  };

  const addQuestion = (q: CandidateQuestion) => {
    selected.push(q);
    usedIds.add(q.id);
    for (const code of q.subtopicCodes) usedSubtopics.add(code);
    if (q.section === "A") marksA += q.marks;
    else marksB += q.marks;
  };

  // Phase 1: Pick one A and one B question from each covered section
  for (const sectionNum of Array.from(coveredSections).sort()) {
    const aPool = sectionPoolsA[sectionNum] ?? [];
    const bPool = sectionPoolsB[sectionNum] ?? [];

    if (marksA < halfTarget) {
      const qA = pick(aPool);
      if (qA && marksA + qA.marks <= halfTarget * 1.3) addQuestion(qA);
    }
    if (marksB < halfTarget) {
      const qB = pick(bPool);
      if (qB && marksB + qB.marks <= halfTarget * 1.3) addQuestion(qB);
    }
  }

  // Phase 2: Fill remaining marks, alternating A/B, preferring new subtopics
  const sections = Array.from(coveredSections).sort();
  let iters = 0;
  while (marksA + marksB < targetMarks * 0.9 && iters < 30) {
    iters++;
    const needMoreA = marksA <= marksB;
    const targetPool = needMoreA ? poolA : poolB;
    const q = pick(targetPool, sections);
    if (!q) break;
    const currentTotal = marksA + marksB;
    // Don't overshoot by more than 15%
    if (currentTotal + q.marks > targetMarks * 1.15) break;
    addQuestion(q);
  }

  // Fill any remaining gaps with unknown-section questions
  for (const q of poolUnknown) {
    if (usedIds.has(q.id)) continue;
    const currentTotal = marksA + marksB;
    if (currentTotal >= targetMarks * 0.9) break;
    if (currentTotal + q.marks > targetMarks * 1.15) continue;
    addQuestion(q);
  }

  // 6. Build TestQueueItem output (sorted A first, then B)
  const sortedSelected = [
    ...selected.filter((q) => q.section === "A"),
    ...selected.filter((q) => q.section === "B"),
    ...selected.filter((q) => !q.section),
  ];

  const result = sortedSelected.map((q) => ({
    id: q.id,
    code: q.code,
    section: q.section,
    curriculum: q.curriculum,
    hasQuestion: q.has_question_images,
    hasMarkscheme: q.has_markscheme_images,
    marks: q.marks,
  }));

  const totalSelectedMarks = selected.reduce((sum, q) => sum + q.marks, 0);
  const estimatedMinutes = Math.ceil((12 / 11) * totalSelectedMarks);

  return NextResponse.json({
    questions: result,
    stats: {
      totalMarks: totalSelectedMarks,
      estimatedMinutes,
      sectionAMarks: marksA,
      sectionBMarks: marksB,
      coveredSections: Array.from(coveredSections).sort(),
    },
  });
}
