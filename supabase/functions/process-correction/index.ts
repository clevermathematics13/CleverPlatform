import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY") ?? "";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

function uint8ToBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunkSize = 8192;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode(...chunk);
  }
  return btoa(binary);
}

// Robust JSON parser — falls back to regex extraction if JSON.parse fails
function parseJudgment(text: string): { status: string; comment: string } {
  const clean = text.replace(/```json|```/g, "").trim();
  try {
    const p = JSON.parse(clean);
    return { status: p.status ?? "missing", comment: p.comment ?? "" };
  } catch {
    // Fallback: extract via regex
    const statusMatch = clean.match(/"status"\s*:\s*"(addressed|partial|missing)"/);
    const commentMatch = clean.match(/"comment"\s*:\s*"((?:[^"\\]|\\.)*)"/);
    return {
      status: statusMatch?.[1] ?? "missing",
      comment: commentMatch?.[1]?.replace(/\\"/g, '"').replace(/\\n/g, " ") ?? "Could not parse AI judgment.",
    };
  }
}

async function extractWorking(pdfBase64: string, unearned: any[]): Promise<Record<string, string>> {
  const questionList = unearned.map((item) => {
    const label = item.part_label ? `Q${item.question_number}(${item.part_label})` : `Q${item.question_number}`;
    const q = item.content_latex ?? "(question text unavailable)";
    return `- ${label}: ${q.slice(0, 200)}`;
  }).join("\n");

  const prompt = `This is a student's handwritten mathematics correction document. The student lost marks on the following questions:\n\n${questionList}\n\nFor each question, extract the student's written working as LaTeX. If no working is visible, return an empty string.\n\nReturn ONLY a JSON object with keys like "Q1b", "Q7a" and LaTeX string values. No explanation, no markdown fences.`;

  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-api-key": ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01" },
    body: JSON.stringify({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 4096,
      messages: [{ role: "user", content: [
        { type: "document", source: { type: "base64", media_type: "application/pdf", data: pdfBase64 } },
        { type: "text", text: prompt },
      ]}],
    }),
  });

  if (!response.ok) throw new Error(`Anthropic error: ${response.status} ${await response.text()}`);
  const data = await response.json();
  const text = data.content?.[0]?.text ?? "{}";
  try { return JSON.parse(text.replace(/```json|```/g, "").trim()); } catch { return {}; }
}

async function judgeOne(item: any, studentLatex: string): Promise<any> {
  if (!studentLatex.trim()) {
    return { ...item, extracted_latex: "", status: "missing", comment: "No working found in the uploaded document for this question." };
  }

  const prompt = `You are an IB Mathematics examiner reviewing a student's correction.\n\nQuestion:\n${item.content_latex ?? "(unavailable)"}\n\nMark scheme:\n${item.markscheme_latex ?? "(unavailable)"}\n\nStudent correction:\n${studentLatex}\n\nThe student was awarded ${item.marks_awarded} out of ${item.max_marks} marks.\n\nClassify as addressed/partial/missing and write a 1-2 sentence comment referencing specific mathematics.\n\nReturn ONLY valid JSON with no extra text: { "status": "addressed"|"partial"|"missing", "comment": "your comment here" }`;

  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-api-key": ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01" },
    body: JSON.stringify({ model: "claude-haiku-4-5-20251001", max_tokens: 512, messages: [{ role: "user", content: prompt }] }),
  });

  let status = "missing", comment = "";
  if (response.ok) {
    const data = await response.json();
    const text = data.content?.[0]?.text ?? "{}";
    const parsed = parseJudgment(text);
    status = parsed.status;
    comment = parsed.comment;
  }
  return { ...item, extracted_latex: studentLatex, status, comment };
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

  let uploadRecord: any;
  try {
    const body = await req.json();
    if (!body.upload_id) return new Response("Ignored", { status: 200 });
    const { data, error } = await supabase.from("pdf_uploads")
      .select("id, student_id, test_id, storage_path, file_name").eq("id", body.upload_id).single();
    if (error || !data) return new Response(JSON.stringify({ error: "Upload not found" }), { status: 404 });
    uploadRecord = data;
  } catch (_e) {
    return new Response(JSON.stringify({ error: "Invalid body" }), { status: 400 });
  }

  const { id: uploadId, student_id: studentId, test_id: testId, storage_path: storagePath } = uploadRecord;

  const { data: checkRow, error: upsertErr } = await supabase.from("correction_checks")
    .upsert({ pdf_upload_id: uploadId, student_id: studentId, test_id: testId, status: "processing" }, { onConflict: "pdf_upload_id" })
    .select("id").single();
  if (upsertErr || !checkRow) return new Response(JSON.stringify({ error: upsertErr?.message ?? "Upsert failed" }), { status: 500 });
  const checkId = checkRow.id;

  try {
    const { data: rawItems, error: itemsErr } = await supabase.from("test_items")
      .select("id, question_number, part_label, max_marks, ib_question_code").eq("test_id", testId).order("sort_order");
    if (itemsErr) throw new Error(itemsErr.message);

    const { data: marksData } = await supabase.from("student_marks")
      .select("test_item_id, marks_awarded").eq("student_id", studentId)
      .in("test_item_id", (rawItems ?? []).map((i: any) => i.id));
    const marksMap: Record<string, number> = {};
    (marksData ?? []).forEach((m: any) => { marksMap[m.test_item_id] = m.marks_awarded; });

    const unearnedRaw = (rawItems ?? []).filter((item: any) => (marksMap[item.id] ?? 0) < item.max_marks);
    if (unearnedRaw.length === 0) {
      await supabase.from("correction_checks").update({ status: "done", extracted_latex: {}, question_feedback: [] }).eq("id", checkId);
      return new Response(JSON.stringify({ ok: true, message: "No unearned marks" }), { status: 200 });
    }

    const ibCodes = [...new Set(unearnedRaw.map((i: any) => i.ib_question_code).filter(Boolean))] as string[];
    const { data: ibQs } = await supabase.from("ib_questions").select("id, code").in("code", ibCodes);
    const ibIdMap: Record<string, string> = {};
    (ibQs ?? []).forEach((q: any) => { ibIdMap[q.code] = q.id; });
    const ibIds = Object.values(ibIdMap);
    const { data: qParts } = ibIds.length > 0
      ? await supabase.from("question_parts").select("question_id, part_label, content_latex, markscheme_latex").in("question_id", ibIds)
      : { data: [] };
    const latexMap: Record<string, { content: string | null; markscheme: string | null }> = {};
    (qParts ?? []).forEach((qp: any) => {
      const code = Object.keys(ibIdMap).find((k) => ibIdMap[k] === qp.question_id);
      if (code) latexMap[`${code}__${qp.part_label ?? ""}`] = { content: qp.content_latex, markscheme: qp.markscheme_latex };
    });

    const unearned = unearnedRaw.map((item: any) => {
      const lt = latexMap[`${item.ib_question_code}__${item.part_label ?? ""}`];
      return { id: item.id, question_number: item.question_number, part_label: item.part_label ?? "",
        max_marks: item.max_marks, ib_question_code: item.ib_question_code, marks_awarded: marksMap[item.id] ?? 0,
        content_latex: lt?.content ?? null, markscheme_latex: lt?.markscheme ?? null };
    });

    const { data: fileData, error: dlErr } = await supabase.storage.from("corrections").download(storagePath);
    if (dlErr || !fileData) throw new Error(dlErr?.message ?? "PDF download failed");
    const pdfBytes = new Uint8Array(await fileData.arrayBuffer());
    const pdfBase64 = uint8ToBase64(pdfBytes);

    const extractedLatex = await extractWorking(pdfBase64, unearned);
    const questionFeedback = [];
    for (const item of unearned) {
      const key = item.part_label ? `Q${item.question_number}${item.part_label}` : `Q${item.question_number}`;
      const altKey = item.part_label ? `Q${item.question_number}(${item.part_label})` : `Q${item.question_number}`;
      const studentLatex = extractedLatex[key] ?? extractedLatex[altKey] ?? "";
      const feedback = await judgeOne(item, studentLatex);
      questionFeedback.push(feedback);
    }

    await supabase.from("correction_checks")
      .update({ status: "done", extracted_latex: extractedLatex, question_feedback: questionFeedback })
      .eq("id", checkId);

    return new Response(JSON.stringify({ ok: true, processed: unearned.length }), { status: 200 });

  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await supabase.from("correction_checks").update({ status: "error", error_message: message }).eq("id", checkId);
    return new Response(JSON.stringify({ error: message }), { status: 500 });
  }
});
