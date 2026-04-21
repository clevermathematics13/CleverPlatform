import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getDriveTokenFromCookie } from "@/lib/google-drive";
import { google } from "googleapis";
import { OAuth2Client } from "google-auth-library";

export const maxDuration = 300; // 5 minutes for bulk extraction

function getAuthedClient(token: Record<string, unknown>) {
  const oauth2 = new OAuth2Client(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET
  );
  oauth2.setCredentials(token);
  return oauth2;
}

async function getDocImages(
  auth: OAuth2Client,
  docId: string
): Promise<
  { objectId: string; contentUri: string; width: number; height: number }[]
> {
  const docs = google.docs({ version: "v1", auth });
  const { data: doc } = await docs.documents.get({ documentId: docId });

  const images: {
    objectId: string;
    contentUri: string;
    width: number;
    height: number;
  }[] = [];

  const inlineObjects = doc.inlineObjects ?? {};
  for (const [objectId, obj] of Object.entries(inlineObjects)) {
    const embedded = obj.inlineObjectProperties?.embeddedObject;
    if (!embedded?.imageProperties?.contentUri) continue;
    images.push({
      objectId,
      contentUri: embedded.imageProperties.contentUri,
      width: embedded.size?.width?.magnitude ?? 0,
      height: embedded.size?.height?.magnitude ?? 0,
    });
  }

  return images;
}

async function downloadImage(
  auth: OAuth2Client,
  uri: string
): Promise<{ buffer: Buffer; contentType: string }> {
  const accessToken = (await auth.getAccessToken()).token;
  const res = await fetch(uri, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) {
    throw new Error(`Failed to download image: ${res.status}`);
  }
  const contentType = res.headers.get("content-type") ?? "image/png";
  const arrayBuffer = await res.arrayBuffer();
  return { buffer: Buffer.from(arrayBuffer), contentType };
}

function extensionForType(contentType: string): string {
  if (contentType.includes("jpeg") || contentType.includes("jpg")) return "jpg";
  if (contentType.includes("gif")) return "gif";
  if (contentType.includes("webp")) return "webp";
  if (contentType.includes("svg")) return "svg";
  return "png";
}

async function extractOneQuestion(
  supabase: Awaited<ReturnType<typeof createClient>>,
  auth: OAuth2Client,
  question: { id: string; code: string; google_doc_id: string; google_ms_id: string | null }
): Promise<{ code: string; questionImages: number; msImages: number; error?: string }> {
  let questionCount = 0;
  let msCount = 0;

  // Extract question doc images
  try {
    const images = await getDocImages(auth, question.google_doc_id);
    for (let i = 0; i < images.length; i++) {
      const { buffer, contentType } = await downloadImage(auth, images[i].contentUri);
      const ext = extensionForType(contentType);
      const storagePath = `${question.code}/question/${String(i + 1).padStart(2, "0")}.${ext}`;

      const { error: uploadErr } = await supabase.storage
        .from("question-images")
        .upload(storagePath, buffer, { contentType, upsert: true });

      if (uploadErr) {
        if (uploadErr.message?.toLowerCase().includes("bucket not found")) {
          return {
            code: question.code,
            questionImages: questionCount,
            msImages: msCount,
            error: "Storage bucket 'question-images' was not found. Run migration 013_question_images.sql in the same Supabase project used by NEXT_PUBLIC_SUPABASE_URL.",
          };
        }
        console.error(`Upload failed ${storagePath}:`, uploadErr);
        continue;
      }

      await supabase.from("question_images").upsert(
        {
          question_id: question.id,
          image_type: "question",
          storage_path: storagePath,
          source_google_doc_id: question.google_doc_id,
          sort_order: i,
          alt_text: `Question image ${i + 1} for ${question.code}`,
        },
        { onConflict: "question_id,image_type,sort_order" }
      );
      questionCount++;
    }
  } catch (err) {
    return {
      code: question.code,
      questionImages: questionCount,
      msImages: 0,
      error: `Question doc: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  // Extract markscheme doc images
  if (question.google_ms_id) {
    try {
      const images = await getDocImages(auth, question.google_ms_id);
      for (let i = 0; i < images.length; i++) {
        const { buffer, contentType } = await downloadImage(auth, images[i].contentUri);
        const ext = extensionForType(contentType);
        const storagePath = `${question.code}/markscheme/${String(i + 1).padStart(2, "0")}.${ext}`;

        const { error: uploadErr } = await supabase.storage
          .from("question-images")
          .upload(storagePath, buffer, { contentType, upsert: true });

        if (uploadErr) {
          if (uploadErr.message?.toLowerCase().includes("bucket not found")) {
            return {
              code: question.code,
              questionImages: questionCount,
              msImages: msCount,
              error: "Storage bucket 'question-images' was not found. Run migration 013_question_images.sql in the same Supabase project used by NEXT_PUBLIC_SUPABASE_URL.",
            };
          }
          console.error(`Upload failed ${storagePath}:`, uploadErr);
          continue;
        }

        await supabase.from("question_images").upsert(
          {
            question_id: question.id,
            image_type: "markscheme",
            storage_path: storagePath,
            source_google_doc_id: question.google_ms_id,
            sort_order: i,
            alt_text: `Markscheme image ${i + 1} for ${question.code}`,
          },
          { onConflict: "question_id,image_type,sort_order" }
        );
        msCount++;
      }
    } catch (err) {
      return {
        code: question.code,
        questionImages: questionCount,
        msImages: msCount,
        error: `Markscheme doc: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  }

  return { code: question.code, questionImages: questionCount, msImages: msCount };
}

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }
  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single();
  if (!profile || profile.role !== "teacher") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const token = (await getDriveTokenFromCookie()) as Record<string, unknown> | null;
  if (!token) {
    return NextResponse.json(
      { error: "Google Drive not connected. Please connect first." },
      { status: 401 }
    );
  }

  const auth = getAuthedClient(token);

  // Optional: skip questions that already have images extracted
  let skipExisting = false;
  try {
    const body = await request.json().catch(() => ({}));
    skipExisting = body?.skipExisting === true;
  } catch { /* no body */ }

  // Get all questions that have a google_doc_id
  let { data: questions, error: qErr } = await supabase
    .from("ib_questions")
    .select("id, code, google_doc_id, google_ms_id")
    .not("google_doc_id", "is", null)
    .order("code");

  if (!qErr && questions && skipExisting) {
    const { data: existing } = await supabase
      .from("question_images")
      .select("question_id");
    if (existing && existing.length > 0) {
      const doneIds = new Set(existing.map((r: { question_id: string }) => r.question_id));
      questions = questions.filter((q) => !doneIds.has(q.id));
    }
  }

  if (qErr) {
    return NextResponse.json({ error: qErr.message }, { status: 500 });
  }

  if (!questions || questions.length === 0) {
    return NextResponse.json({ error: "No questions with Google Docs found" }, { status: 404 });
  }

  // Stream progress as newline-delimited JSON
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      let streamOpen = true;

      const send = (data: Record<string, unknown>) => {
        if (!streamOpen) return;
        try {
          controller.enqueue(encoder.encode(JSON.stringify(data) + "\n"));
        } catch (e) {
          streamOpen = false;
          console.error("Stream enqueue failed:", e);
        }
      };

      try {
        send({ type: "start", total: questions.length });

        let completed = 0;
        let totalImages = 0;
        const errors: { code: string; error: string }[] = [];

        for (const q of questions) {
          try {
            const result = await extractOneQuestion(supabase, auth, q as {
              id: string;
              code: string;
              google_doc_id: string;
              google_ms_id: string | null;
            });

            completed++;
            totalImages += result.questionImages + result.msImages;

            if (result.error) {
              errors.push({ code: result.code, error: result.error });
              console.error(`[extract] ${result.code}: ${result.error}`);

              if (result.error.includes("Storage bucket 'question-images' was not found")) {
                send({ type: "error", error: result.error });
                break;
              }
            }

            send({
              type: "progress",
              completed,
              total: questions.length,
              code: result.code,
              questionImages: result.questionImages,
              msImages: result.msImages,
              error: result.error ?? null,
            });
          } catch (questionErr) {
            completed++;
            const errMsg = questionErr instanceof Error ? questionErr.message : String(questionErr);
            errors.push({ code: q.code, error: errMsg });
            console.error(`Error extracting ${q.code}:`, questionErr);
            send({
              type: "progress",
              completed,
              total: questions.length,
              code: q.code,
              questionImages: 0,
              msImages: 0,
              error: errMsg,
            });
          }

          // Small delay to avoid rate limiting Google API
          await new Promise((r) => setTimeout(r, 200));
        }

        send({
          type: "done",
          totalQuestions: completed,
          totalImages,
          errors: errors.length,
          errorDetails: errors,
        });
      } catch (e) {
        console.error("Stream fatal error:", e);
        send({ type: "error", error: e instanceof Error ? e.message : String(e) });
      } finally {
        if (streamOpen) {
          controller.close();
          streamOpen = false;
        }
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}
